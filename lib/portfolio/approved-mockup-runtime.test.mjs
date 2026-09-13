import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  approvedBoardRendererFingerprint,
  renderAssignedApprovedBoard,
} from "./approved-assigned-board-renderer.ts";
import {
  APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES,
  approvedMockupRuntimeFilePath,
  approvedMockupSourceRuntimeRoot,
  inspectApprovedMockupRuntime,
} from "./approved-mockup-runtime.ts";
import { packageApprovedMockupRuntime } from "../../scripts/package-approved-mockup-runtime.mjs";

async function portraitSlides() {
  return Promise.all([0, 1].map(async (index) => ({
    index,
    buffer: await sharp({ create: { width: 210, height: 297, channels: 3,
      background: index ? "#e7eef9" : "#fbe8dc" } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="210" height="297"><circle cx="${55 + index * 85}" cy="${70 + index * 115}" r="31" fill="#213047"/></svg>`) }])
      .png().toBuffer(),
  })));
}

async function tree(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(absolute);
      else output.push(relative);
    }
  }
  await visit(root);
  return output.sort();
}

test("source renderer resolves approved assets independently of ambient cwd", async () => {
  const temporaryCwd = await mkdtemp(path.join(os.tmpdir(), "woolim-render-cwd-"));
  const originalCwd = process.cwd();
  try {
    const slides = await portraitSlides();
    const before = await renderAssignedApprovedBoard({ aspectClass: "a4_portrait",
      templateId: "a4-portrait-body-4-studio", slides, scale: .5 });
    process.chdir(temporaryCwd);
    const after = await renderAssignedApprovedBoard({ aspectClass: "a4_portrait",
      templateId: "a4-portrait-body-4-studio", slides, scale: .5 });
    assert.deepEqual(after.bytes, before.bytes);
    assert.equal(after.rendererFingerprint, before.rendererFingerprint);
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  }
});

test("uninstalled fixed-allowlist package is reproducible and fails closed after tampering", {
  timeout: 60_000,
}, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "woolim-render-package-test-"));
  const packageRoot = path.join(temporaryRoot, "runtime");
  try {
    const packaged = await packageApprovedMockupRuntime(packageRoot);
    assert.equal(packaged.installed, false);
    assert.equal(packaged.fileCount, APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES.length);
    const files = await tree(packageRoot);
    assert.equal(files.some((file) => /(^|\/)node_modules(\/|$)/.test(file)), false);
    assert.equal(files.some((file) => /(^|\/)\.env(?:\.|$)/.test(file)), false);
    assert.equal(files.includes("lib/portfolio/a4-source-fit.ts"), true);
    assert.deepEqual(files.filter((file) => file !== "approved-mockup-runtime-manifest.json"),
      [...APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES].sort());

    const inspected = await inspectApprovedMockupRuntime({ runtimeRoot: packageRoot,
      requireManifest: true, requiredPaths: APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES });
    assert.equal(inspected.packaged, true);
    assert.equal(inspected.runtimeFingerprint, packaged.runtimeFingerprint);

    const sourceFingerprint = await approvedBoardRendererFingerprint(
      "a4_portrait", "a4-portrait-body-4-studio",
    );
    const packageFingerprint = await approvedBoardRendererFingerprint(
      "a4_portrait", "a4-portrait-body-4-studio", { runtimeRoot: packageRoot },
    );
    assert.equal(packageFingerprint, sourceFingerprint);
    const slides = await portraitSlides();
    const source = await renderAssignedApprovedBoard({ aspectClass: "a4_portrait",
      templateId: "a4-portrait-body-4-studio", slides, scale: .5 });
    const packagedRender = await renderAssignedApprovedBoard({ aspectClass: "a4_portrait",
      templateId: "a4-portrait-body-4-studio", slides, scale: .5, runtimeRoot: packageRoot });
    assert.deepEqual(packagedRender.bytes, source.bytes);

    await appendFile(approvedMockupRuntimeFilePath(
      "lib/portfolio/a4-source-fit.ts", packageRoot,
    ), "\n", "utf8");
    await assert.rejects(
      approvedBoardRendererFingerprint("a4_portrait", "a4-portrait-body-4-studio",
        { runtimeRoot: packageRoot }),
      /APPROVED_MOCKUP_RUNTIME_FILE_MISMATCH:lib\/portfolio\/a4-source-fit\.ts/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("explicit package roots are absolute and a manifest cannot be skipped", async () => {
  await assert.rejects(
    inspectApprovedMockupRuntime({ runtimeRoot: "relative/runtime", requireManifest: true,
      requiredPaths: APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES }),
    /APPROVED_MOCKUP_RUNTIME_ROOT_MUST_BE_ABSOLUTE/,
  );
  await assert.rejects(
    inspectApprovedMockupRuntime({ runtimeRoot: approvedMockupSourceRuntimeRoot(),
      requireManifest: true, requiredPaths: APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES }),
    /APPROVED_MOCKUP_RUNTIME_MANIFEST_REQUIRED/,
  );
});
