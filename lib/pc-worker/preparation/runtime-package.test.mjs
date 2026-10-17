import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PREPARATION_RUNTIME_SOURCE_FILES, PREPARATION_RUNTIME_MANIFEST,
  assertPreparationNodeVersion, inspectPreparationRuntime, packagePreparationRuntime,
  preparationChildEnvironment, preparationLaunchArguments, stagePreparationRuntime,
} from "../../../scripts/preparation-runtime-package.mjs";

const execute = promisify(execFile);
const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let temporary;
let packaged;
test.before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "woolim-preparation-package-test-"));
  packaged = await packagePreparationRuntime(path.join(temporary, "package"));
});
test.after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function isolatedCopy(label) {
  const target = path.join(temporary, label);
  await cp(packaged.outputRoot, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}
async function sourceCopy(label) {
  const target = await isolatedCopy(label);
  await cp(path.join(sourceRoot, "package-lock.json"), path.join(target, "package-lock.json"));
  return target;
}

test("dependency collection excludes npm bin links before recursion but includes locked nested semver", { skip: process.platform === "win32" }, async () => {
  const source = await sourceCopy("npm-bin-source");
  const bin = path.join(source, "node_modules/sharp/node_modules/.bin");
  await mkdir(bin, { recursive: true });
  await symlink("../semver/bin/semver.js", path.join(bin, "semver"));
  const result = await packagePreparationRuntime(path.join(temporary, "npm-bin-output"), { sourceRoot: source });
  const inspected = await inspectPreparationRuntime(result.outputRoot, { expectedFingerprint: result.fingerprint });
  assert.ok(inspected.files.some((entry) => entry.path === "node_modules/sharp/node_modules/semver/bin/semver.js"));
  assert.equal(inspected.files.some((entry) => entry.path.includes("/.bin/")), false);
});

test("dependency payload rejects internal external and broken symlinks", { skip: process.platform === "win32" }, async () => {
  const source = await sourceCopy("unsafe-file-links");
  const extra = path.join(source, "node_modules/@xmldom/xmldom/unsafe-link");
  const external = path.join(temporary, "external.txt");
  await writeFile(external, "outside package");
  for (const [index, target] of ["package.json", external, "missing-target"].entries()) {
    await symlink(target, extra);
    await assert.rejects(packagePreparationRuntime(path.join(temporary, `unsafe-link-output-${index}`), { sourceRoot: source }), /UNSAFE_FILE/);
    await rm(extra);
  }
});

test("dependency roots and excluded node_modules must be real directories", { skip: process.platform === "win32" }, async () => {
  const source = await sourceCopy("unsafe-directory-links");
  for (const [index, relative] of ["node_modules/sharp/node_modules/semver", "node_modules/sharp/node_modules"].entries()) {
    const original = path.join(source, relative);
    const moved = path.join(temporary, `moved-dependency-${index}`);
    await rename(original, moved);
    await symlink(moved, original, "dir");
    await assert.rejects(packagePreparationRuntime(path.join(temporary, `unsafe-directory-output-${index}`), { sourceRoot: source }), /UNSAFE_FILE|UNSAFE_ROOT/);
    await rm(original);
    await rename(moved, original);
  }
  // A node_modules entry that is not a directory cannot exploit the exclusion.
  const nested = path.join(source, "node_modules/@xmldom/xmldom/node_modules");
  await writeFile(nested, "not a directory");
  await assert.rejects(packagePreparationRuntime(path.join(temporary, "unsafe-node-modules-file"), { sourceRoot: source }), /UNSAFE_FILE/);
});

test("dependency payload still rejects hard links and environment files", async () => {
  const source = await sourceCopy("unsafe-hardlink-env");
  const extra = path.join(source, "node_modules/@xmldom/xmldom/unsafe-file");
  await link(path.join(source, "node_modules/@xmldom/xmldom/package.json"), extra);
  await assert.rejects(packagePreparationRuntime(path.join(temporary, "unsafe-hardlink-output"), { sourceRoot: source }), /UNSAFE_FILE/);
  await rm(extra);
  await writeFile(path.join(source, "node_modules/@xmldom/xmldom/.env.local"), "FIXTURE_ONLY=true");
  await assert.rejects(packagePreparationRuntime(path.join(temporary, "unsafe-env-output"), { sourceRoot: source }), /ENV_FILE_FORBIDDEN/);
});

test("dependency payload rejects special files before reading them", { skip: process.platform === "win32" }, async () => {
  const source = await sourceCopy("unsafe-special-file");
  await execute("mkfifo", [path.join(source, "node_modules/@xmldom/xmldom/unsafe-fifo")]);
  await assert.rejects(packagePreparationRuntime(path.join(temporary, "unsafe-fifo-output"), { sourceRoot: source }), /UNSAFE_FILE/);
});

test("finished package inspection never excludes unexpected node_modules entries", async () => {
  const output = await isolatedCopy("unexpected-bin-file");
  const bin = path.join(output, "node_modules/.bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "unexpected"), "not in manifest");
  await assert.rejects(inspectPreparationRuntime(output, { expectedFingerprint: packaged.fingerprint }), /FILE_SET_MISMATCH/);
});

test("finished package inspection rejects unexpected node_modules symlinks", { skip: process.platform === "win32" }, async () => {
  const output = await isolatedCopy("unexpected-bin-link");
  const bin = path.join(output, "node_modules/.bin");
  await mkdir(bin);
  await symlink("../sharp/package.json", path.join(bin, "unexpected"));
  await assert.rejects(inspectPreparationRuntime(output, { expectedFingerprint: packaged.fingerprint }), /UNSAFE_FILE/);
});

test("fixed preparation payload includes local editor, title and PowerPoint adapter without secrets or app code", async () => {
  const inspected = await inspectPreparationRuntime(packaged.outputRoot, { expectedFingerprint: packaged.fingerprint });
  const files = inspected.files.map((file) => file.path);
  assert.equal(packaged.installed, false);
  assert.deepEqual(files.filter((file) => !file.startsWith("node_modules/") && file !== "package.json").sort(), [...PREPARATION_RUNTIME_SOURCE_FILES].sort());
  for (const required of ["tools/woolim-pc-worker/prepare-slides.ps1", "scripts/prepare-portfolio-local.mjs",
    "lib/pc-worker/preparation/local-review-server.ts", "lib/portfolio/thumbnail-title-overlay.ts", "public/fonts/Paperlogy-8ExtraBold.ttf"]) assert.ok(files.includes(required));
  assert.equal(files.some((file) => /(^|\/)(?:\.env(?:\.|$)|worker\.ps1$)|^app\/|^supabase\//i.test(file)), false);
  assert.ok(inspected.dependencies.some((entry) => entry.name === "sharp"));
  assert.ok(inspected.dependencies.some((entry) => entry.name === "@xmldom/xmldom"));
  assert.equal(inspected.dependencies.some((entry) => entry.name === "next" || entry.name.startsWith("@supabase/")), false);
  const sourceFingerprintFiles = ["lib/portfolio/approved-mockup-runtime.ts", "lib/portfolio/approved-assigned-board-renderer.ts"];
  for (const file of sourceFingerprintFiles) assert.equal(digest(await readFile(path.join(sourceRoot, file))), digest(await readFile(path.join(packaged.outputRoot, file))));
});

test("offline package is reproducible and does not overwrite nonempty destinations", async () => {
  const second = await packagePreparationRuntime(path.join(temporary, "second"));
  assert.equal(second.fingerprint, packaged.fingerprint);
  await assert.rejects(packagePreparationRuntime(packaged.outputRoot), /OUTPUT_NOT_EMPTY/);
});

test("immutable package verification requires an external trusted fingerprint and platform match", async () => {
  await assert.rejects(inspectPreparationRuntime(packaged.outputRoot), /TRUSTED_FINGERPRINT_REQUIRED/);
  await assert.rejects(inspectPreparationRuntime(packaged.outputRoot, { expectedFingerprint: "0".repeat(64) }), /MANIFEST_MISMATCH/);
  await assert.rejects(inspectPreparationRuntime(packaged.outputRoot, { expectedFingerprint: packaged.fingerprint, platform: "not-a-platform" }), /MANIFEST_MISMATCH/);
});

test("changed source, unexpected env file and altered manifest each fail closed", async () => {
  const changed = await isolatedCopy("changed");
  await appendFile(path.join(changed, "lib/portfolio/thumbnail-title-overlay.ts"), "\n");
  await assert.rejects(inspectPreparationRuntime(changed, { expectedFingerprint: packaged.fingerprint }), /FILE_MISMATCH/);
  const extra = await isolatedCopy("extra");
  await writeFile(path.join(extra, ".env.local"), "DO_NOT_READ=this-is-test-fixture-only\n");
  await assert.rejects(inspectPreparationRuntime(extra, { expectedFingerprint: packaged.fingerprint }), /FILE_SET_MISMATCH/);
  const altered = await isolatedCopy("manifest-changed");
  const manifestPath = path.join(altered, PREPARATION_RUNTIME_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files[0].sha256 = "1".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(inspectPreparationRuntime(altered, { expectedFingerprint: packaged.fingerprint }), /MANIFEST_MISMATCH/);
});

test("Node policy rejects pre-22.6 and malformed versions", () => {
  for (const version of ["20.19.0", "22.5.1", "garbage", "v24.1.0"]) assert.throws(() => assertPreparationNodeVersion(version), /NODE_22_6_REQUIRED/);
  for (const version of ["22.6.0", "22.20.0", "24.0.0"]) assert.doesNotThrow(() => assertPreparationNodeVersion(version));
});

test("launcher only forwards preparation CLI options and strips inherited credentials/preloads", () => {
  const args = ["--source", "C:\\work with spaces\\file.pptx", "--work-root", "C:\\private\\review", "--redact", "--serve"];
  assert.deepEqual(preparationLaunchArguments(args), args);
  for (const invalid of [[], ["--eval", "evil"], [...args, "--serve"], [...args, "--source", "other"], [...args, "--token", "secret"]]) {
    assert.throws(() => preparationLaunchArguments(invalid), /PREPARATION_LAUNCH_/);
  }
  const child = preparationChildEnvironment({ Path: "test-system-path", SYSTEMROOT: "test-windows", LOCALAPPDATA: "test-private",
    WOOLIM_PC_WORKER_SECRET: "never-forward", SUPABASE_SERVICE_ROLE_KEY: "never-forward", NODE_OPTIONS: "--require never-forward", GEMINI_API_KEY: "never-forward", GEMINI_ENABLED: "true" });
  assert.deepEqual(Object.keys(child).sort(), ["GEMINI_ALLOW_NON_PRODUCTION", "GEMINI_ENABLED", "LOCALAPPDATA", "Path", "SYSTEMROOT"].sort());
  assert.equal(child.GEMINI_ENABLED, "false");
  assert.equal(child.GEMINI_ALLOW_NON_PRODUCTION, "false");
});

test("packaged --check loads private dependencies offline without starting preparation", async () => {
  const { stdout, stderr } = await execute(process.execPath, [path.join(packaged.outputRoot, "scripts/run-preparation-runtime.mjs"),
    "--expected-fingerprint", packaged.fingerprint, "--check"], { cwd: temporary, env: preparationChildEnvironment(), timeout: 30_000, windowsHide: true });
  assert.equal(stderr, "");
  const result = JSON.parse(stdout.trim());
  assert.equal(result.ready, true);
  assert.equal(result.started, false);
  assert.equal(result.fingerprint, packaged.fingerprint);
});

test("complete packaged import graph resolves with only allowlisted runtime dependencies", async () => {
  const code = `await Promise.all(${JSON.stringify(PREPARATION_RUNTIME_SOURCE_FILES.filter((file) => file.endsWith(".ts")))}.map(file => import(new URL(file, 'file://' + process.cwd().replaceAll('\\\\', '/') + '/'))));console.log('IMPORT_GRAPH_OK');`;
  const { stdout } = await execute(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code],
    { cwd: packaged.outputRoot, env: preparationChildEnvironment(), timeout: 30_000, windowsHide: true });
  assert.equal(stdout.trim(), "IMPORT_GRAPH_OK");
});

test("versioned staging is idempotent, keeps previous versions and never activates a task or pointer", async () => {
  const runtimeRoot = path.join(temporary, "preparation-runtimes");
  await mkdir(runtimeRoot);
  const previous = path.join(runtimeRoot, "previous-version-marker");
  await writeFile(previous, "previous-preserved");
  const result = await stagePreparationRuntime({ packageRoot: packaged.outputRoot, runtimeRoot, expectedFingerprint: packaged.fingerprint });
  assert.equal(result.activated, false);
  assert.equal(result.reused, false);
  assert.equal(await readFile(previous, "utf8"), "previous-preserved");
  const repeated = await stagePreparationRuntime({ packageRoot: packaged.outputRoot, runtimeRoot, expectedFingerprint: packaged.fingerprint });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.runtimeRoot, result.runtimeRoot);
  assert.deepEqual((await readdir(runtimeRoot)).sort(), [path.basename(result.runtimeRoot), "previous-version-marker"].sort());
  await assert.rejects(stagePreparationRuntime({ packageRoot: packaged.outputRoot, runtimeRoot: temporary, expectedFingerprint: packaged.fingerprint }), /DEDICATED_ROOT_REQUIRED/);
  await assert.rejects(stagePreparationRuntime({ packageRoot: packaged.outputRoot, runtimeRoot: path.join(packaged.outputRoot, "preparation-runtimes"), expectedFingerprint: packaged.fingerprint }), /ROOT_OVERLAPS_PACKAGE/);
});
