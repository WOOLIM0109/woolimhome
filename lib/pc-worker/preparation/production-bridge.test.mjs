import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProductionBridgeTransport, createProductionMockupBridge, validateBridgeDownloadUrl,
  validateBridgeSettings, publicProductionBridgeError } from "./production-bridge.ts";

const settings = { serverUrl: "https://woolim-site.vercel.app", workerId: "test-worker", workerName: "테스트", secret: "mock-secret-not-real" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = Buffer.from("PKmock-pptx-source");
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const session = () => ({ id: randomUUID(), workItemId: randomUUID(), mode: "full", sourceUrl: "https://source.supabase.co/storage/source.pptx",
  sourceAuthorization: "Bearer mock-source-only", fileName: "../never-used-as-path.pptx", sourceBindingHash: "1".repeat(64), sourceHash: hash(source) });
function snapshotFixture() {
  const boards = Array.from({ length: 5 }, (_, i) => { const png = Buffer.from(`mock-approved-png-${i}`); return { png, imageHash: hash(png) }; });
  const base = Buffer.from("mock-approved-redacted-base");
  return { boards, titlelessBasePng: base, snapshotHash: "2".repeat(64), descriptor: { mode: "full", sourceHash: hash(source), localWorkId: randomUUID(),
    thumbnail: { baseImageHash: hash(base) }, boards: boards.map(({ imageHash }) => ({ imageHash })) } };
}
function uploadPlan(item, snapshot) {
  const entries = [...snapshot.boards.map((board, index) => ({ key: String(index), sha256: board.imageHash, path: `verified-local/${item.workItemId}/${item.id}/${index}.png` })),
    { key: "base", sha256: snapshot.descriptor.thumbnail.baseImageHash, path: `verified-local/${item.workItemId}/${item.id}/titleless.png` }];
  return { sessionId: item.id, snapshotHash: snapshot.snapshotHash,
    uploads: entries.map((entry) => ({ ...entry, signedUrl: `https://storage.supabase.co/storage/v1/object/upload/sign/portfolio-rendered/${entry.path}?token=mock` })) };
}

test("bridge transport rejects arbitrary/private/non-HTTPS destinations without a request", () => {
  for (const serverUrl of ["http://woolim-site.vercel.app", "https://evil.example", "https://woolim-site.vercel.app/anything"]) {
    assert.throws(() => validateBridgeSettings({ ...settings, serverUrl }), /SETTINGS_INVALID/);
  }
  for (const url of ["http://source.supabase.co/file", "https://127.0.0.1/file", "https://localhost/file", "https://user:pass@source.supabase.co/file",
    "https://source.supabase.co.evil.example/file", "https://evil.example/file", "https://[::1]/file", "https://source.supabase.co:444/file"]) {
    assert.throws(() => validateBridgeDownloadUrl(url), /DOWNLOAD_/);
  }
  assert.throws(() => validateBridgeDownloadUrl("https://www.worksapis.com/file", true), /HOST_REJECTED/);
  assert.equal(publicProductionBridgeError(new Error("https://url.example/?secret=hidden")), "MOCKUP_BRIDGE_OPERATION_FAILED");
});

test("claim includes fixed bridge identity and never invokes legacy queue or AI", async () => {
  const calls = [];
  const transport = createProductionBridgeTransport(settings, { fetch: async (url, options) => { calls.push({ url, options }); return json({ session: null }); } });
  assert.equal(await transport.claim(), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://woolim-site.vercel.app/api/worker/mockup-sessions/claim");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.bridgeVersion, "mockup-bridge-1"); assert.equal(body.workerVersion, "2.10.0");
  assert.equal(body.workerId, settings.workerId);
  assert.equal(calls[0].options.redirect, "error");
});

test("source redirects never forward bearer credentials across origins and bytes bind to SHA", async () => {
  const calls = [], item = session();
  const transport = createProductionBridgeTransport(settings, { fetch: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: "https://other.supabase.co/source.pptx" } }) : new Response(source);
  } });
  assert.deepEqual(await transport.download(item), source);
  assert.equal(calls[0].options.headers.Authorization, item.sourceAuthorization);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls.some((call) => call.options.headers.Authorization === `Bearer ${settings.secret}`), false);
  const wrong = createProductionBridgeTransport(settings, { fetch: async () => new Response(Buffer.from("PKdifferent")) });
  await assert.rejects(wrong.download(item), /SOURCE_HASH_CHANGED/);
  const oversized = createProductionBridgeTransport(settings, { fetch: async () => new Response("x", { headers: { "content-length": String(256 * 1024 * 1024 + 1) } }) });
  await assert.rejects(oversized.download(item), /RESPONSE_TOO_LARGE/);
});

test("source download rejects unsafe redirect and does not retry a server failure", async () => {
  let count = 0;
  const redirect = createProductionBridgeTransport(settings, { fetch: async () => { count++; return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } }); } });
  await assert.rejects(redirect.download(session()), /DOWNLOAD_HOST_REJECTED/);
  assert.equal(count, 1);
  const failed = createProductionBridgeTransport(settings, { fetch: async () => { count++; throw new Error("secret HTTP message"); } });
  await assert.rejects(failed.claim(), /^Error: MOCKUP_BRIDGE_OPERATION_FAILED$/);
  assert.equal(count, 2);
});

test("staging uploads only verified board/base bytes sequentially and requires remote read-back stage receipt", async () => {
  const item = session(), snapshot = snapshotFixture(), plan = uploadPlan(item, snapshot), calls = [];
  let concurrent = 0, maximum = 0;
  const transport = createProductionBridgeTransport(settings, { fetch: async (url, options) => {
    calls.push({ url, options });
    if (options.method === "PUT") { concurrent++; maximum = Math.max(maximum, concurrent); await Promise.resolve(); concurrent--; return new Response(null, { status: calls.length === 2 ? 409 : 200 }); }
    const body = JSON.parse(options.body);
    return body.action === "prepare-upload" ? json(plan) : json({ sessionId: item.id, staged: true });
  } });
  assert.deepEqual(await transport.stage(item, snapshot), { sessionId: item.id, staged: true });
  assert.equal(maximum, 1);
  assert.equal(calls.filter((call) => call.options.method === "PUT").length, 6);
  assert.equal(JSON.parse(calls.at(-1).options.body).action, "stage");
  assert.equal(calls.filter((call) => call.options.method === "PUT").some((call) => Buffer.from(call.options.body).equals(source)), false);
});

test("bad upload plan fails before any PUT and failed PUT never auto-retries or stages", async () => {
  const item = session(), snapshot = snapshotFixture(), plan = uploadPlan(item, snapshot);
  plan.uploads[0].path = "some-other-work-item/raw.pptx";
  let count = 0;
  const invalid = createProductionBridgeTransport(settings, { fetch: async () => { count++; return json(plan); } });
  await assert.rejects(invalid.stage(item, snapshot), /UPLOAD_PLAN_INVALID/);
  assert.equal(count, 1);
  const calls = [];
  const failing = createProductionBridgeTransport(settings, { fetch: async (url, options) => { calls.push(options.method);
    return options.method === "PUT" ? json({ error: "storage unavailable" }, 503) : json(uploadPlan(item, snapshot));
  } });
  await assert.rejects(failing.stage(item, snapshot), /UPLOAD_FAILED/);
  assert.deepEqual(calls, ["POST", "PUT"]);
});

test("local preparation stops at manual review, stages only explicit callback, and resumes without reconversion", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "b-"));
  const privateRoot = path.join(temporary, "WoolimWorker", "p"), item = session(), snapshot = snapshotFixture(), buildId = randomUUID();
  const postCalls = [], serverInputs = []; let claims = 0, prepared = 0, redacted = 0, staged = 0, closed = 0;
  const transport = { claim: async () => claims++ === 0 ? item : null, download: async () => source,
    post: async (id, body) => { postCalls.push({ id, body }); return body.action === "status" ? { sessionId: id, status: "review" } : { ok: true }; },
    stage: async () => { staged++; return { sessionId: item.id, staged: true }; } };
  const dependencies = {
    prepare: async () => { prepared++; return { status: "ready_for_local_review", buildId, workId: snapshot.descriptor.localWorkId,
      inspection: { sourceHash: hash(source) }, selection: { selected: [1, 2], reserves: [3] } }; },
    redact: async () => { redacted++; return []; },
    serve: async (input) => { serverInputs.push(input); return { url: "http://127.0.0.1:12345", launchUrl: `http://127.0.0.1:12345/launch/${"3".repeat(64)}`, close: async () => { closed++; } }; },
    withSnapshot: async (identity, options, operation) => { assert.equal(identity.buildId, buildId); assert.equal(options.expectedSnapshotHash, snapshot.snapshotHash); return operation(snapshot); },
  };
  let bridge;
  try {
    bridge = await createProductionMockupBridge({ privateRoot, transport }, dependencies);
    await bridge.tick();
    assert.equal(prepared, 1); assert.equal(redacted, 1); assert.equal(staged, 0);
    assert.deepEqual(postCalls.map((call) => call.body.status), ["preparing", "review"]);
    const recordPath = path.join(privateRoot, item.id, "bridge-session.json");
    const recordText = await readFile(recordPath, "utf8");
    assert.equal(/secret|Authorization|sourceUrl|launch\/|fileName/.test(recordText), false);
    assert.deepEqual(await readdir(path.join(privateRoot, item.id, "s")), ["source.pptx"]);
    await bridge.close();
    bridge = await createProductionMockupBridge({ privateRoot, transport }, dependencies);
    assert.deepEqual(await bridge.resume(), { resumed: 1 });
    assert.equal(prepared, 1); assert.equal(redacted, 1); assert.equal(staged, 0);
    await serverInputs.at(-1).productionBridge.stage(snapshot.snapshotHash);
    assert.equal(staged, 1);
    assert.equal(JSON.parse(await readFile(recordPath, "utf8")).state, "staged");
    await bridge.tick();
    assert.ok(closed >= 2);
  } finally { await bridge?.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("preparation failure produces one safe failure event and no automatic retry or stage", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "b-")), item = session(), calls = [], events = [];
  const privateRoot = path.join(temporary, "WoolimWorker", "p"); let count = 0;
  const bridge = await createProductionMockupBridge({ privateRoot, onEvent: (event) => events.push(event), transport: {
    claim: async () => count++ === 0 ? item : null, download: async () => source,
    post: async (id, body) => { calls.push(body); return { ok: true }; }, stage: async () => { throw new Error("must not stage"); },
  } }, { prepare: async () => { throw new Error("POWERPOINT_BUSY: test only"); }, serve: async () => { throw new Error("must not serve"); } });
  try {
    const result = await bridge.tick();
    assert.equal(result.errorCode, "POWERPOINT_BUSY");
    assert.deepEqual(calls.map((call) => call.status), ["preparing", "failed"]);
    assert.equal(events[0].code, "POWERPOINT_BUSY");
    await bridge.tick(); assert.equal(calls.length, 2);
  } finally { await bridge.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("terminal remote sessions close live local editors, persist terminal state and free review capacity", async () => {
  for (const terminal of ["cancelled", "failed", "staged", "activated"]) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "b-")), item = session();
    const privateRoot = path.join(temporary, "WoolimWorker", "p");
    let claims = 0, remote = "review", closed = 0, prepared = 0; const posts = [];
    const bridge = await createProductionMockupBridge({ privateRoot, transport: {
      claim: async () => claims++ === 0 ? item : null, download: async () => source,
      post: async (id, body) => { posts.push(body); return body.action === "status" ? { sessionId: id, status: remote } : { ok: true }; },
      stage: async () => { throw new Error("must not stage"); },
    } }, {
      prepare: async () => { prepared++; return { status: "held", buildId: randomUUID(), workId: randomUUID(), inspection: { sourceHash: hash(source) } }; },
      serve: async () => ({ url: "http://127.0.0.1:12345", launchUrl: `http://127.0.0.1:12345/launch/${"3".repeat(64)}`, close: async () => { closed++; } }),
    });
    try {
      await bridge.tick(); remote = terminal; await bridge.tick();
      assert.equal(closed, 1); assert.equal(claims, 2); assert.equal(prepared, 1);
      assert.equal(JSON.parse(await readFile(path.join(privateRoot, item.id, "bridge-session.json"), "utf8")).state, terminal);
      assert.deepEqual(posts.map(p => p.action), ["progress", "progress", "status"]);
      await bridge.tick(); assert.equal(posts.length, 3); // Closed sessions are not polled/retried.
    } finally { await bridge.close(); await rm(temporary, { recursive: true, force: true }); }
  }
});

test("resume checks cancellation before source access and never reopens a cancelled editor", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "b-")), item = session();
  const privateRoot = path.join(temporary, "WoolimWorker", "p");
  let claimed = false, remote = "review", served = 0; const posts = [];
  const transport = {
    claim: async () => { if (claimed) return null; claimed = true; return item; }, download: async () => source,
    post: async (id, body) => { posts.push(body); return body.action === "status" ? { sessionId: id, status: remote } : { ok: true }; },
    stage: async () => { throw new Error("must not stage"); },
  };
  const dependencies = {
    prepare: async () => ({ status: "held", buildId: randomUUID(), workId: randomUUID(), inspection: { sourceHash: hash(source) } }),
    serve: async () => { served++; return { url: "http://127.0.0.1:12345", launchUrl: `http://127.0.0.1:12345/launch/${"3".repeat(64)}`, close: async () => {} }; },
  };
  let bridge = await createProductionMockupBridge({ privateRoot, transport }, dependencies);
  try {
    await bridge.tick(); await bridge.close(); remote = "cancelled";
    await rm(path.join(privateRoot, item.id, "s", "source.pptx"));
    bridge = await createProductionMockupBridge({ privateRoot, transport }, dependencies);
    assert.deepEqual(await bridge.resume(), { resumed: 0 }); assert.equal(served, 1);
    assert.equal(posts.at(-1).action, "status");
    assert.equal(JSON.parse(await readFile(path.join(privateRoot, item.id, "bridge-session.json"), "utf8")).state, "cancelled");
  } finally { await bridge.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("unavailable or invalid status never closes live editor, marks failure or claims another session", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "b-")), item = session();
  const privateRoot = path.join(temporary, "WoolimWorker", "p");
  let claims = 0, closed = 0; const posts = [];
  const bridge = await createProductionMockupBridge({ privateRoot, transport: {
    claim: async () => claims++ === 0 ? item : null, download: async () => source,
    post: async (id, body) => { posts.push(body); return body.action === "status" ? { sessionId: randomUUID(), status: "cancelled" } : { ok: true }; },
    stage: async () => { throw new Error("must not stage"); },
  } }, {
    prepare: async () => ({ status: "held", buildId: randomUUID(), workId: randomUUID(), inspection: { sourceHash: hash(source) } }),
    serve: async () => ({ url: "http://127.0.0.1:12345", launchUrl: `http://127.0.0.1:12345/launch/${"3".repeat(64)}`, close: async () => { closed++; } }),
  });
  try {
    await bridge.tick(); const result = await bridge.tick();
    assert.equal(result.errorCode, "MOCKUP_BRIDGE_STATUS_INVALID"); assert.equal(closed, 0); assert.equal(claims, 1);
    assert.equal(posts.some(p => p.status === "failed"), false);
    assert.equal(JSON.parse(await readFile(path.join(privateRoot, item.id, "bridge-session.json"), "utf8")).state, "review");
  } finally { await bridge.close(); await rm(temporary, { recursive: true, force: true }); }
});

async function preparationBridgeFixture(options = {}) {
  // Leave room for the generation suffix under the actual Windows COM limit.
  // This unique test directory is not the live WoolimWorker installation.
  const temporary = await mkdtemp(path.join(process.platform === "win32" ? path.dirname(os.tmpdir()) : os.tmpdir(), "b-")), item = session();
  const privateRoot = path.join(temporary, "WoolimWorker", "p"), oldBuild = randomUUID(), newBuild = randomUUID();
  const oldWork = randomUUID(), newWork = randomUUID(), posts = [], serverInputs = [], closed = [], prepareInputs = [], reviewIdentities = [];
  let claimed = false, validations = 0, redactions = 0;
  const state = { remote: "review", reopen: false, issueCount: 0 };
  const transport = {
    claim: async () => { if (claimed) return null; claimed = true; return item; }, download: async () => source,
    post: async (id, body) => {
      posts.push(body);
      if (body.action === "status") return { sessionId: id, status: state.remote, reopenRequested: state.reopen };
      if (options.rejectNewUrl && body.localReviewUrl?.includes("12342")) throw new Error("MOCKUP_BRIDGE_SERVER_REJECTED");
      if (body.action === "progress" && body.status === "review") state.reopen = false;
      return { ok: true };
    }, stage: async (...args) => { if (options.onStage) return options.onStage(...args); throw new Error("must not stage"); },
  };
  const dependencies = {
    prepare: async input => {
      prepareInputs.push(input); await mkdir(input.workRoot, { recursive: true });
      await writeFile(path.join(input.workRoot, "synthetic-marker"), prepareInputs.length === 1 ? "original-build" : "new-private-attempt");
      if (prepareInputs.length > 1) await options.onReprepare?.(input);
      return { status: prepareInputs.length === 1 ? "held" : "ready_for_local_review", buildId: prepareInputs.length === 1 ? oldBuild : newBuild,
        workId: prepareInputs.length === 1 ? oldWork : newWork, inspection: { sourceHash: hash(source) }, selection: { selected: [1, 2], reserves: [3] } };
    },
    redact: async () => { redactions++; return []; },
    withSnapshot: async (_identity, _input, operation) => {
      if (!options.snapshot) throw new Error("unexpected snapshot request");
      return operation(options.snapshot);
    },
    serve: async input => {
      serverInputs.push(input); const index = serverInputs.length, url = `http://127.0.0.1:${12340 + index}`;
      return { url, launchUrl: `${url}/launch/${"3".repeat(64)}`, close: async () => { closed.push(index); },
        ...(options.noReopen ? {} : { issueLaunchUrl: () => { state.issueCount++; return `${url}/launch/${"4".repeat(64)}`; } }) };
    },
    review: {
      get: async identity => { reviewIdentities.push(identity); return { buildId: identity.buildId }; },
      prepareEvidence: async () => ({ buildId: oldBuild }),
      readEvidence: async () => Buffer.from("synthetic evidence"),
      apply: async () => { validations++; if (options.rejectFinalValidation && validations === 2) throw new Error("PREPARATION_REVIEW_STALE");
        return { artworkReviews: [], expectedCurrentBuild: { buildId: oldBuild, revision: 7, sourceHash: hash(source) } }; },
    },
  };
  const bridge = await createProductionMockupBridge({ privateRoot, transport }, dependencies);
  await bridge.tick();
  const recordPath = path.join(privateRoot, item.id, "bridge-session.json");
  return { bridge, transport, dependencies, temporary, item, privateRoot, recordPath, oldBuild, newBuild, oldWork, newWork, posts, serverInputs, closed, prepareInputs, reviewIdentities, state,
    redactions: () => redactions, validations: () => validations,
    request: { expectedCurrentBuild: { buildId: oldBuild, revision: 7, sourceHash: hash(source) }, artworkReviews: [] },
    cleanup: async () => { await bridge.close(); await rm(temporary, { recursive: true, force: true }); } };
}

test("explicit preparation review applies into a fresh generation and swaps editor only after verified success", async () => {
  const f = await preparationBridgeFixture();
  try {
    const originalRecord = JSON.parse(await readFile(f.recordPath, "utf8"));
    const result = await f.serverInputs[0].preparationReview.apply(f.request);
    assert.equal(result.applied, true); assert.equal(result.buildId, f.newBuild); assert.match(result.launchUrl, /12342\/launch\//);
    const record = JSON.parse(await readFile(f.recordPath, "utf8"));
    assert.equal(record.buildId, f.newBuild); assert.equal(record.workId, f.newWork); assert.match(record.workDirectory, /^w[a-f0-9]{8}$/);
    assert.equal(record.sourceHash, originalRecord.sourceHash); assert.equal(record.workItemId, originalRecord.workItemId);
    assert.notEqual(f.prepareInputs[1].workRoot, f.prepareInputs[0].workRoot); assert.equal(f.prepareInputs[1].expectedCurrentBuild, undefined);
    assert.equal(await readFile(path.join(f.prepareInputs[0].workRoot, "synthetic-marker"), "utf8"), "original-build");
    assert.equal(f.redactions(), 1); assert.equal(f.validations(), 2); assert.deepEqual(f.closed, []);
    await assert.rejects(f.serverInputs[0].preparationReview.get(), /REVIEW_STALE/);
    await f.serverInputs[1].preparationReview.get(); assert.equal(f.reviewIdentities.at(-1).workRoot, f.prepareInputs[1].workRoot);
    await f.bridge.tick(); assert.deepEqual(f.closed, [1]);
  } finally { await f.cleanup(); }
});

test("failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts", async () => {
  for (const options of [{ error: /POWERPOINT_BUSY/, onReprepare: async () => { throw new Error("POWERPOINT_BUSY"); } },
    { error: /PREPARATION_REVIEW_STALE/, rejectFinalValidation: true }, { error: /MOCKUP_BRIDGE_SERVER_REJECTED/, rejectNewUrl: true },
    { error: /MOCKUP_SOURCE_HASH_CHANGED/, onReprepare: async input => { await writeFile(input.sourcePath, "PKchanged-during-preparation"); } }]) {
    const f = await preparationBridgeFixture(options);
    try {
      const before = await readFile(f.recordPath, "utf8");
      await assert.rejects(f.serverInputs[0].preparationReview.apply(f.request), options.error);
      assert.equal(await readFile(f.recordPath, "utf8"), before);
      assert.equal(await readFile(path.join(f.prepareInputs[0].workRoot, "synthetic-marker"), "utf8"), "original-build");
      assert.equal((await f.serverInputs[0].preparationReview.get()).buildId, f.oldBuild);
      assert.equal(f.closed.includes(1), false); assert.equal(f.posts.some(p => p.status === "failed"), false);
    } finally { await f.cleanup(); }
  }
});

test("restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory", async () => {
  const f = await preparationBridgeFixture(); let resumed;
  try {
    await f.serverInputs[0].preparationReview.apply(f.request); await f.bridge.close();
    resumed = await createProductionMockupBridge({ privateRoot: f.privateRoot, transport: f.transport }, f.dependencies);
    assert.deepEqual(await resumed.resume(), { resumed: 1 });
    assert.equal(f.serverInputs.at(-1).root, f.prepareInputs[1].workRoot); assert.equal(f.serverInputs.at(-1).buildId, f.newBuild);
    assert.equal(f.prepareInputs.length, 2); await resumed.close();
    const record = JSON.parse(await readFile(f.recordPath, "utf8")); record.workDirectory = "../other";
    await writeFile(f.recordPath, JSON.stringify(record));
    resumed = await createProductionMockupBridge({ privateRoot: f.privateRoot, transport: f.transport }, f.dependencies);
    assert.deepEqual(await resumed.resume(), { resumed: 0 }); assert.equal(f.prepareInputs.length, 2);
  } finally { await resumed?.close(); await f.cleanup(); }
});

test("preparation actions serialize and uploading sessions cannot change selection or source format", async () => {
  let release, started; const waiting = new Promise(resolve => { release = resolve; }), running = new Promise(resolve => { started = resolve; });
  const f = await preparationBridgeFixture({ onReprepare: async () => { started(); await waiting; } });
  try {
    f.state.remote = "uploading";
    await assert.rejects(f.serverInputs[0].preparationReview.apply(f.request), /REVIEW_NOT_EDITABLE/); assert.equal(f.prepareInputs.length, 1);
    f.state.remote = "review"; const pending = f.serverInputs[0].preparationReview.apply(f.request); await running;
    await assert.rejects(f.serverInputs[0].preparationReview.apply(f.request), /PREPARATION_BUSY/);
    assert.deepEqual(await f.bridge.tick(), { claimed: false, busy: true }); release(); await pending;
    assert.equal(f.prepareInputs.length, 2);
  } finally { release(); await f.cleanup(); }
});

test("explicit reopen rotates only launch token with no preparation, source download or record mutation", async () => {
  const f = await preparationBridgeFixture();
  try {
    const before = await readFile(f.recordPath, "utf8"), initial = f.posts.length;
    f.state.remote = "uploading"; f.state.reopen = true; await f.bridge.tick();
    assert.equal(f.state.issueCount, 1); assert.equal(f.prepareInputs.length, 1); assert.equal(f.serverInputs.length, 1);
    assert.equal(await readFile(f.recordPath, "utf8"), before);
    assert.deepEqual(f.posts.slice(initial).map(p => p.action), ["status", "progress"]);
    assert.equal(f.posts.at(-1).sourceHash, hash(source)); assert.match(f.posts.at(-1).localReviewUrl, /4{64}$/);
  } finally { await f.cleanup(); }
});

test("missing local token-rotation feature fails safely without conversion or requeue", async () => {
  const f = await preparationBridgeFixture({ noReopen: true });
  try {
    f.state.reopen = true; const result = await f.bridge.tick();
    assert.equal(result.errorCode, "MOCKUP_BRIDGE_REOPEN_UNAVAILABLE"); assert.equal(f.prepareInputs.length, 1);
    assert.equal(f.posts.some(p => p.status === "failed"), false); assert.deepEqual(f.closed, []);
  } finally { await f.cleanup(); }
});

test("verified snapshot upload holds exclusive preparation lock through record commit", async () => {
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; }), running = new Promise(resolve => { started = resolve; });
  const options = { snapshot: snapshotFixture(), onStage: async item => { started(); await waiting; return { sessionId: item.id, staged: true }; } };
  const f = await preparationBridgeFixture(options);
  options.snapshot.descriptor.localWorkId = f.oldWork;
  try {
    const pending = f.serverInputs[0].productionBridge.stage(options.snapshot.snapshotHash); await running;
    const postsBefore = f.posts.length, preparedBefore = f.prepareInputs.length;
    await assert.rejects(f.serverInputs[0].preparationReview.prepareEvidence({}), /PREPARATION_BUSY/);
    await assert.rejects(f.serverInputs[0].preparationReview.apply(f.request), /PREPARATION_BUSY/);
    await assert.rejects(f.serverInputs[0].productionBridge.stage(options.snapshot.snapshotHash), /PREPARATION_BUSY/);
    assert.deepEqual(await f.bridge.tick(), { claimed: false, busy: true });
    assert.equal(f.posts.length, postsBefore); assert.equal(f.prepareInputs.length, preparedBefore); assert.equal(f.validations(), 0);
    release(); await pending;
    assert.equal(JSON.parse(await readFile(f.recordPath, "utf8")).state, "staged");
    assert.deepEqual(await f.bridge.tick(), { claimed: false, busy: false });
    assert.deepEqual(f.closed, [1]);
  } finally { release(); await f.cleanup(); }
});

test("failed snapshot upload releases preparation lock and preserves review record", async () => {
  const options = { snapshot: snapshotFixture(), onStage: async () => { throw new Error("MOCKUP_BRIDGE_UPLOAD_FAILED"); } };
  const f = await preparationBridgeFixture(options); options.snapshot.descriptor.localWorkId = f.oldWork;
  try {
    const before = await readFile(f.recordPath, "utf8");
    await assert.rejects(f.serverInputs[0].productionBridge.stage(options.snapshot.snapshotHash), /MOCKUP_BRIDGE_UPLOAD_FAILED/);
    assert.equal(await readFile(f.recordPath, "utf8"), before); assert.deepEqual(f.closed, []);
    assert.deepEqual(await f.bridge.tick(), { claimed: false, busy: false });
    assert.deepEqual(await f.serverInputs[0].preparationReview.prepareEvidence({}), { buildId: f.oldBuild });
    assert.equal(f.prepareInputs.length, 1);
  } finally { await f.cleanup(); }
});
