import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PreparationRevisionConflictError,
  PreparationWorkLockedError,
  PreparationWorkStoreError,
  openPreparationWorkStore,
} from "./work-store.ts";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(source = "source-a", settings = "converter-v1", font = "fonts-v1") {
  return {
    source: { sha256: sha256(source), bytes: Buffer.byteLength(source) },
    conversionSettingsFingerprint: settings,
    fontFingerprint: font,
  };
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "woolim-preparation-store-"));
  const stores = [];
  t.after(async () => {
    for (const store of stores.reverse()) await store.release().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    async open(overrides = {}) {
      const store = await openPreparationWorkStore({ root, ...options, ...overrides });
      stores.push(store);
      return store;
    },
  };
}

async function putArtifact(store, build, key, relativePath, contents) {
  const outputPath = await store.prepareArtifactPath(build.buildId, relativePath);
  await writeFile(outputPath, contents);
  return store.recordArtifact({
    buildId: build.buildId,
    key,
    expectedRevision: build.revision,
    relativePath,
  });
}

async function prepareThroughPreview(store, build) {
  build = await putArtifact(store, build, "preflight", "preflight.json", "{\"ok\":true}");
  build = await store.completeStage({
    buildId: build.buildId,
    stage: "source_inspection",
    expectedRevision: build.revision,
    inputFingerprint: "source-inspection-v1",
    artifactKeys: ["preflight"],
  });
  build = await putArtifact(store, build, "preview:1", "previews/slide001.png", "preview-one");
  build = await store.completeStage({
    buildId: build.buildId,
    stage: "preview_generation",
    expectedRevision: build.revision,
    inputFingerprint: "preview-profile-v1",
    artifactKeys: ["preview:1"],
  });
  return build;
}

test("retains a buildId on resume and starts a separate build when source, settings, or fonts change", async (t) => {
  const f = await fixture(t);
  let store = await f.open();
  const workId = randomUUID();
  const first = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    workId,
    fingerprint: fingerprint(),
  });
  assert.equal(first.resumed, false);
  assert.match(first.work.workId, /^[0-9a-f-]{36}$/i);
  assert.match(first.build.buildId, /^[0-9a-f-]{36}$/i);
  assert.equal(first.build.fingerprint.source.bytes, 8);

  const active = await store.setActiveSetRef({
    expectedRevision: first.work.revision,
    activeSetRef: { setId: "already-published-set", buildId: null },
  });
  await store.release();
  store = await f.open();

  const resumed = await store.beginOrResumeBuild({
    expectedWorkRevision: active.revision,
    workId,
    fingerprint: fingerprint(),
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.build.buildId, first.build.buildId);

  const changedSource = await store.beginOrResumeBuild({
    expectedWorkRevision: resumed.work.revision,
    workId,
    fingerprint: fingerprint("source-b"),
  });
  assert.equal(changedSource.resumed, false);
  assert.notEqual(changedSource.build.buildId, first.build.buildId);
  assert.deepEqual(changedSource.work.activeSetRef, { setId: "already-published-set", buildId: null });
  assert.equal((await store.readBuild(first.build.buildId)).buildId, first.build.buildId);

  const changedSettings = await store.beginOrResumeBuild({
    expectedWorkRevision: changedSource.work.revision,
    fingerprint: fingerprint("source-b", "converter-v2"),
  });
  assert.notEqual(changedSettings.build.buildId, changedSource.build.buildId);
  const changedFonts = await store.beginOrResumeBuild({
    expectedWorkRevision: changedSettings.work.revision,
    fingerprint: fingerprint("source-b", "converter-v2", "fonts-v2"),
  });
  assert.notEqual(changedFonts.build.buildId, changedSettings.build.buildId);
  assert.equal(changedFonts.work.buildIds.length, 4);
  await assert.rejects(
    store.prepareArtifactPath(first.build.buildId, "old.png"),
    (error) => error instanceof PreparationWorkStoreError && error.code === "BUILD_NOT_CURRENT",
  );
});

test("persists individually completed artifacts and reuses only files whose bytes and SHA still match", async (t) => {
  const f = await fixture(t);
  let store = await f.open();
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  let build = started.build;
  build = await putArtifact(store, build, "preview:1", "previews/slide001.png", "one");
  build = await putArtifact(store, build, "preview:2", "previews/slide002.png", "two");
  build = await putArtifact(store, build, "preview:3", "previews/slide003.png", "three");
  await store.release();

  store = await f.open();
  const resumed = await store.beginOrResumeBuild({
    expectedWorkRevision: started.work.revision,
    fingerprint: fingerprint(),
  });
  assert.equal(resumed.build.buildId, build.buildId);
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:1"));
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:2"));
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:3"));

  const corruptPath = await store.prepareArtifactPath(build.buildId, "previews/slide002.png");
  await writeFile(corruptPath, "changed");
  assert.equal(await store.getReusableArtifact(build.buildId, "preview:2"), null);
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:1"));
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:3"));

  const missingPath = await store.prepareArtifactPath(build.buildId, "previews/slide003.png");
  await unlink(missingPath);
  assert.equal(await store.getReusableArtifact(build.buildId, "preview:3"), null);
  assert.ok(await store.getReusableArtifact(build.buildId, "preview:1"));
});

test("records atomic stage checkpoints and selection edits invalidate only downstream completion", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  let build = await prepareThroughPreview(store, started.build);
  build = await store.recordSelection({
    buildId: build.buildId,
    expectedRevision: build.revision,
    expectedSelectionRevision: build.selectionRevision,
    selectionFingerprint: "slides-1-2",
    data: { selectedSlides: [1, 2] },
  });
  build = await putArtifact(store, build, "highres:1", "highres/slide001.png", "high-resolution-one");
  build = await putArtifact(store, build, "highres:2", "highres/slide002.png", "high-resolution-two");
  build = await store.completeStage({
    buildId: build.buildId,
    stage: "high_resolution_conversion",
    expectedRevision: build.revision,
    inputFingerprint: "hires-profile-v1:slides-1-2",
    artifactKeys: ["highres:1", "highres:2"],
  });
  assert.ok(await store.getReusableStage(build.buildId, "high_resolution_conversion"));

  const changed = await store.recordSelection({
    buildId: build.buildId,
    expectedRevision: build.revision,
    expectedSelectionRevision: build.selectionRevision,
    selectionFingerprint: "slides-1-3",
    data: { selectedSlides: [1, 3] },
  });
  assert.ok(changed.stages.source_inspection);
  assert.ok(changed.stages.preview_generation);
  assert.ok(changed.stages.slide_selection);
  assert.equal(changed.stages.high_resolution_conversion, undefined);
  assert.ok(await store.getReusableArtifact(build.buildId, "highres:1"));
  assert.ok(await store.getReusableArtifact(build.buildId, "highres:2"));

  const unchanged = await store.recordSelection({
    buildId: changed.buildId,
    expectedRevision: changed.revision,
    expectedSelectionRevision: changed.selectionRevision,
    selectionFingerprint: "slides-1-3",
    data: { selectedSlides: [1, 3] },
  });
  assert.equal(unchanged.revision, changed.revision);
  assert.equal(unchanged.selectionRevision, changed.selectionRevision);

  const previewRevalidated = await store.completeStage({
    buildId: unchanged.buildId,
    stage: "preview_generation",
    expectedRevision: unchanged.revision,
    inputFingerprint: "preview-profile-v1",
    artifactKeys: ["preview:1"],
  });
  assert.equal(previewRevalidated.stages.slide_selection, undefined);
  const selectionRevalidated = await store.recordSelection({
    buildId: previewRevalidated.buildId,
    expectedRevision: previewRevalidated.revision,
    expectedSelectionRevision: previewRevalidated.selectionRevision,
    selectionFingerprint: "slides-1-3",
    data: { selectedSlides: [1, 3] },
  });
  assert.ok(selectionRevalidated.stages.slide_selection);
  assert.equal(selectionRevalidated.selectionRevision, changed.selectionRevision);
  await assert.rejects(
    store.recordSelection({
      buildId: selectionRevalidated.buildId,
      expectedRevision: selectionRevalidated.revision,
      expectedSelectionRevision: selectionRevalidated.selectionRevision - 1,
      selectionFingerprint: "slides-1-4",
    }),
    (error) => error instanceof PreparationRevisionConflictError
      && error.expectedRevision === selectionRevalidated.selectionRevision - 1,
  );
});

test("rejects stale revisions and will not complete a stage from missing or corrupt artifacts", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  let build = await putArtifact(store, started.build, "preflight", "preflight.json", "valid");
  await assert.rejects(
    store.recordArtifact({
      buildId: build.buildId,
      key: "another",
      expectedRevision: 0,
      relativePath: "preflight.json",
    }),
    (error) => error instanceof PreparationRevisionConflictError
      && error.expectedRevision === 0
      && error.actualRevision === 1,
  );
  await assert.rejects(
    store.completeStage({
      buildId: build.buildId,
      stage: "source_inspection",
      expectedRevision: build.revision,
      inputFingerprint: "source-v1",
      artifactKeys: ["not-recorded"],
    }),
    (error) => error instanceof PreparationWorkStoreError && error.code === "MISSING_ARTIFACT",
  );
  await writeFile(await store.prepareArtifactPath(build.buildId, "preflight.json"), "corrupt");
  await assert.rejects(
    store.completeStage({
      buildId: build.buildId,
      stage: "source_inspection",
      expectedRevision: build.revision,
      inputFingerprint: "source-v1",
      artifactKeys: ["preflight"],
    }),
    (error) => error instanceof PreparationWorkStoreError && error.code === "STALE_ARTIFACT",
  );
});

test("enforces one live process owner and recovers a lock only after its PID is confirmed dead", async (t) => {
  const f = await fixture(t);
  const first = await f.open({ pid: 11001, isProcessAlive: (pid) => pid === 11001 });
  await assert.rejects(
    openPreparationWorkStore({
      root: f.root,
      pid: 22002,
      isProcessAlive: (pid) => pid === 11001,
    }),
    (error) => error instanceof PreparationWorkLockedError && error.ownerPid === 11001,
  );

  const recovered = await f.open({ pid: 22002, isProcessAlive: () => false });
  const started = await recovered.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  assert.equal(started.build.revision, 0);
  await assert.rejects(
    first.beginOrResumeBuild({ expectedWorkRevision: null, fingerprint: fingerprint() }),
    (error) => error instanceof PreparationWorkStoreError && error.code === "LOCK_LOST",
  );
});

test("does not remove malformed locks because a live owner cannot be ruled out", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "woolim-preparation-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = path.join(root, ".preparation-work.lock");
  await writeFile(lockPath, "incomplete-lock");
  await assert.rejects(
    openPreparationWorkStore({ root, pid: 12345, isProcessAlive: () => false }),
    (error) => error instanceof PreparationWorkStoreError && error.code === "CORRUPT_LOCK",
  );
  assert.equal(await readFile(lockPath, "utf8"), "incomplete-lock");
});

test("confines every artifact to its build and rejects traversal, absolute paths, and symlink parents", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  for (const unsafe of ["../escape.png", "..\\escape.png", path.join(f.root, "absolute.png")]) {
    await assert.rejects(
      store.prepareArtifactPath(started.build.buildId, unsafe),
      (error) => error instanceof PreparationWorkStoreError && error.code === "UNSAFE_PATH",
    );
  }

  const outside = await mkdtemp(path.join(os.tmpdir(), "woolim-preparation-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const artifactRoot = path.join(f.root, "builds", started.build.buildId, "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  try {
    await symlink(outside, path.join(artifactRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`symlinks unavailable on this host: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    store.prepareArtifactPath(started.build.buildId, "linked/escape.png"),
    (error) => error instanceof PreparationWorkStoreError && error.code === "UNSAFE_PATH",
  );
  assert.deepEqual(await readdir(outside), []);
});

test("writes parseable JSON snapshots without leaving temporary state files", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: fingerprint(),
  });
  const build = await prepareThroughPreview(store, started.build);
  const workJson = JSON.parse(await readFile(path.join(f.root, "work.json"), "utf8"));
  const buildDirectory = path.join(f.root, "builds", build.buildId);
  const buildJson = JSON.parse(await readFile(path.join(buildDirectory, "record.json"), "utf8"));
  assert.equal(workJson.currentBuildId, build.buildId);
  assert.equal(buildJson.stages.preview_generation.stage, "preview_generation");
  assert.deepEqual(
    (await readdir(f.root)).filter((name) => name.endsWith(".tmp")),
    [],
  );
  assert.deepEqual(
    (await readdir(buildDirectory)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});
