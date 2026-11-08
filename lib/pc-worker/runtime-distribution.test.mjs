import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { publishPreparationRuntime } from "../../scripts/publish-preparation-runtime.mjs";
import { PREPARATION_RUNTIME_MANIFEST, stagePreparationRuntime } from "../../scripts/preparation-runtime-package.mjs";
import { getLatestApprovedRuntime } from "../../tools/woolim-pc-worker/approved-runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fingerprint = "a".repeat(64);
const releaseUrl = "https://github.com/WOOLIM0109/woolimhome/releases/download/runtime-1/preparation-runtime-1.0.0-aaaaaaaa.zip";
const entry = (extra = {}) => ({ fingerprint, version: "1.0.0", platform: "win32", arch: "x64", note: "synthetic", ...extra });
const latest = (entries) => getLatestApprovedRuntime(entries, "win32", "x64");

test("archive approvals preserve offline entries and accept the paired repository release URL and SHA256", () => {
  assert.deepEqual(latest([entry()]), entry());
  const approval = entry({ url: releaseUrl, archiveSha256: "B".repeat(64) });
  assert.deepEqual(latest([entry(), { ...approval, fingerprint: "c".repeat(64) }]), { ...approval, fingerprint: "c".repeat(64) });
  const unicodeTag = entry({ url: releaseUrl.replace("runtime-1", "사무실-1") + "?download=1", archiveSha256: fingerprint });
  assert.deepEqual(latest([unicodeTag]), unicodeTag);
});

test("an invalid archive approval anywhere in the fetched list invalidates the entire list", () => {
  for (const extra of [
    { url: releaseUrl }, { archiveSha256: fingerprint },
    { url: "", archiveSha256: fingerprint }, { url: null, archiveSha256: null },
    { url: releaseUrl, archiveSha256: 123 }, { url: releaseUrl, archiveSha256: "a".repeat(63) },
    { url: releaseUrl, archiveSha256: "g".repeat(64) },
    ...[
      releaseUrl.replace("https:", "http:"), releaseUrl.replace("WOOLIM0109", "other-owner"),
      releaseUrl.replace("github.com", "github.com.evil.invalid"),
      "https://github.com/WOOLIM0109/woolimhome/releases/download/../../../../other-owner/repo/file.zip",
      "https://github.com/WOOLIM0109/woolimhome/releases/download/",
      "https://github.com/WOOLIM0109/woolimhome/releases/download/tag/",
    ].map((url) => ({ url, archiveSha256: fingerprint })),
  ]) {
    assert.throws(() => latest([entry(extra), entry({ fingerprint: "c".repeat(64) })]),
      /PREPARATION_APPROVAL_LIST_INVALID/, JSON.stringify(extra));
  }
});

test("publisher ZIP has a correct SHA256 and installs through the unchanged fingerprint checks", async () => {
  const temporaryBase = path.join(root, ".codex-tmp");
  await mkdir(temporaryBase, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryBase, "distribution-test-"));
  try {
    await assert.rejects(publishPreparationRuntime("relative"), /PREPARATION_PACKAGE_ABSOLUTE_ROOT_REQUIRED/);
    const outputRoot = path.join(temporary, "release");
    const published = await publishPreparationRuntime(outputRoot);
    const bytes = await readFile(published.archivePath);
    assert.equal(published.archiveSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(path.basename(published.archivePath), `preparation-runtime-1.0.0-${published.fingerprint.slice(0, 8)}.zip`);
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const manifest = JSON.parse(await archive.file(PREPARATION_RUNTIME_MANIFEST).async("string"));
    assert.equal(manifest.fingerprint, published.fingerprint);
    assert.deepEqual(Object.keys(archive.files).sort(), [...manifest.files.map((file) => file.path), PREPARATION_RUNTIME_MANIFEST].sort());
    assert.ok(!manifest.files.some((file) => file.path.includes("publish-preparation-runtime")));
    const extracted = path.join(temporary, "extracted");
    for (const [relative, file] of Object.entries(archive.files)) {
      const target = path.join(extracted, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await file.async("nodebuffer"), { flag: "wx" });
    }
    const installed = await stagePreparationRuntime({ packageRoot: extracted,
      runtimeRoot: path.join(temporary, "preparation-runtimes"), expectedFingerprint: published.fingerprint });
    assert.equal(installed.fingerprint, published.fingerprint);
    assert.equal(installed.activated, false);
    await assert.rejects(stagePreparationRuntime({ packageRoot: extracted,
      runtimeRoot: path.join(temporary, "preparation-runtimes"), expectedFingerprint: "b".repeat(64) }),
    /PREPARATION_PACKAGE_MANIFEST_MISMATCH/);
    await assert.rejects(publishPreparationRuntime(outputRoot), /PREPARATION_PACKAGE_OUTPUT_NOT_EMPTY/);
    assert.equal(createHash("sha256").update(await readFile(published.archivePath)).digest("hex"), published.archiveSha256);
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(temporaryBase));
    assert.ok(path.basename(temporary).startsWith("distribution-test-"));
    await rm(temporary, { recursive: true, force: true });
  }
});
