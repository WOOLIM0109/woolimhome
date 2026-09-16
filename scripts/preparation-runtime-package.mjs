import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A separate package contract. Never add these files to the frozen renderer fingerprint. */
export const PREPARATION_RUNTIME_VERSION = "1.0.0";
export const PREPARATION_RUNTIME_MANIFEST = "preparation-runtime-manifest.json";
export const PREPARATION_RUNTIME_SOURCE_FILES = Object.freeze([
  "scripts/preparation-runtime-package.mjs",
  "scripts/run-preparation-runtime.mjs",
  "scripts/run-production-mockup-worker.mjs",
  "scripts/install-preparation-runtime.mjs",
  "scripts/prepare-portfolio-local.mjs",
  "tools/woolim-pc-worker/prepare-slides.ps1",
  "lib/pc-worker/preparation/work-store.ts",
  "lib/pc-worker/preparation/source-format-choice.ts",
  "lib/pc-worker/preparation/preparation-review-types.ts",
  "lib/pc-worker/preparation/preparation-review-service.ts",
  "lib/pc-worker/preparation/preparation-review-client.mjs",
  "lib/pc-worker/preparation/slide-preparation.ts",
  "lib/pc-worker/preparation/redaction-types.ts",
  "lib/pc-worker/preparation/redaction-service.ts",
  "lib/pc-worker/preparation/redaction-renderer.ts",
  "lib/pc-worker/preparation/redaction-editor-client.mjs",
  "lib/pc-worker/preparation/redaction-detection.ts",
  "lib/pc-worker/preparation/private-work-root.ts",
  "lib/pc-worker/preparation/pptx-inspection.ts",
  "lib/pc-worker/preparation/powerpoint-adapter.ts",
  "lib/pc-worker/preparation/pipeline.ts",
  "lib/pc-worker/preparation/mockup-types.ts",
  "lib/pc-worker/preparation/mockup-title-types.ts",
  "lib/pc-worker/preparation/mockup-service.ts",
  "lib/pc-worker/preparation/mockup-request-preparation.ts",
  "lib/pc-worker/preparation/mockup-handoff.ts",
  "lib/pc-worker/preparation/mockup-handoff-types.ts",
  "lib/pc-worker/preparation/production-snapshot-types.ts",
  "lib/pc-worker/preparation/production-snapshot-hash.ts",
  "lib/pc-worker/preparation/production-bridge.ts",
  "lib/pc-worker/preparation/production-bridge-client.mjs",
  "lib/pc-worker/preparation/mockup-editor-client.mjs",
  "lib/pc-worker/preparation/local-review-server.ts",
  "lib/portfolio/approved-16x9-renderer.ts",
  "lib/portfolio/approved-16x9-templates.ts",
  "lib/portfolio/approved-a4-landscape-templates.ts",
  "lib/portfolio/approved-a4-portrait-templates.ts",
  "lib/portfolio/a4-source-fit.ts",
  "lib/portfolio/approved-assigned-board-renderer.ts",
  "lib/portfolio/approved-mockup-geometry.ts",
  "lib/portfolio/approved-mockup-runtime.ts",
  "lib/portfolio/approved-mockup-suite-renderer.ts",
  "lib/portfolio/approved-mockup-suites.ts",
  "lib/portfolio/approved-mockup-title.ts",
  "lib/portfolio/thumbnail-title-overlay.ts",
  "lib/portfolio/photo-detect.ts",
  "lib/portfolio/image-set.ts",
  "lib/content-ops/style-revision-rules.ts",
  "public/fonts/Paperlogy-7Bold.ttf",
  "public/fonts/Paperlogy-8ExtraBold.ttf",
  "public/images/mockup-templates/a4-portrait-dark-wood.png",
  "public/images/woolim-logo-cropped.png",
]);
const ROOT_DEPENDENCIES = Object.freeze(["sharp", "@xmldom/xmldom"]);
const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const MAX_FILES = 5_000;
const MAX_BYTES = 256 * 1024 * 1024;
const fail = (code) => { throw new Error(code); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const preparationSourceRoot = () => fileURLToPath(new URL("../", import.meta.url));

export function assertPreparationNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || +match[1] < 22 || (+match[1] === 22 && +match[2] < 6)) fail("PREPARATION_NODE_22_6_REQUIRED");
}
function safeRelative(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")
    || value.split("/").some((part) => !part || part === "." || part === "..")
    || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) fail("PREPARATION_PACKAGE_INVALID_PATH");
  return value;
}
async function safeRoot(value) {
  if (!path.isAbsolute(value)) fail("PREPARATION_PACKAGE_ABSOLUTE_ROOT_REQUIRED");
  const absolute = path.resolve(value);
  const relative = path.relative(path.parse(absolute).root, absolute);
  let cursor = path.parse(absolute).root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("PREPARATION_PACKAGE_UNSAFE_ROOT");
  }
  return realpath(absolute);
}
async function safeFile(root, relative) {
  safeRelative(relative);
  let cursor = root;
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) {
      fail("PREPARATION_PACKAGE_UNSAFE_FILE");
    }
  }
  return cursor;
}
async function record(root, relative) {
  const absolute = await safeFile(root, relative);
  const info = await lstat(absolute);
  if (info.size > MAX_BYTES) fail("PREPARATION_PACKAGE_TOO_LARGE");
  const bytes = await readFile(absolute);
  return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
}
async function tree(root, relative = "") {
  const result = [];
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    safeRelative(next);
    if (entry.isSymbolicLink()) fail("PREPARATION_PACKAGE_UNSAFE_FILE");
    if (entry.isDirectory()) result.push(...await tree(root, next));
    else if (entry.isFile()) result.push(next);
    else fail("PREPARATION_PACKAGE_UNSAFE_FILE");
    if (result.length > MAX_FILES) fail("PREPARATION_PACKAGE_TOO_MANY_FILES");
  }
  return result.sort();
}
function platformMatches(manifest) {
  return [[manifest.os, process.platform], [manifest.cpu, process.arch]].every(([allowed, current]) => (
    !Array.isArray(allowed) || (!allowed.includes(`!${current}`)
      && (!allowed.some((item) => !item.startsWith("!")) || allowed.includes(current)))
  ));
}
async function dependencyRecords(sourceRoot) {
  const lock = JSON.parse(await readFile(await safeFile(sourceRoot, "package-lock.json"), "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages) fail("PREPARATION_DEPENDENCY_LOCK_REQUIRED");
  const installed = new Map();
  async function visit(name, parent = "", optional = false) {
    if (!PACKAGE_NAME.test(name)) fail("PREPARATION_DEPENDENCY_NAME_INVALID");
    // npm's package tree is copied at the same relative paths. No arbitrary require search outside the checkout.
    const candidates = parent ? [`${parent}/node_modules/${name}`, `node_modules/${name}`] : [`node_modules/${name}`];
    let relative = null;
    let metadata = null;
    for (const candidate of candidates) {
      try {
        metadata = JSON.parse(await readFile(await safeFile(sourceRoot, `${candidate}/package.json`), "utf8"));
        relative = candidate;
        break;
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (!relative) { if (optional) return; fail("PREPARATION_DEPENDENCY_MISSING"); }
    if (!platformMatches(metadata)) { if (optional) return; fail("PREPARATION_DEPENDENCY_PLATFORM_MISMATCH"); }
    if (metadata.name !== name || lock.packages[relative]?.version !== metadata.version) fail("PREPARATION_DEPENDENCY_LOCK_MISMATCH");
    if (installed.has(relative)) return;
    installed.set(relative, { path: relative, name, version: metadata.version });
    for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) await visit(dependency, relative);
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {}).sort()) await visit(dependency, relative, true);
  }
  for (const name of ROOT_DEPENDENCIES) await visit(name);
  return [...installed.values()].sort((a, b) => a.path.localeCompare(b.path));
}
async function assertAllowlistedImportGraph(root) {
  const allowed = new Set(PREPARATION_RUNTIME_SOURCE_FILES);
  for (const relative of PREPARATION_RUNTIME_SOURCE_FILES.filter((file) => /\.(?:ts|mjs)$/.test(file))) {
    const text = await readFile(await safeFile(root, relative), "utf8");
    const imports = text.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
    for (const match of imports) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith(".")) {
        const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
        if (!allowed.has(dependency)) fail(`PREPARATION_SOURCE_DEPENDENCY_NOT_ALLOWLISTED:${dependency}`);
      } else if (!ROOT_DEPENDENCIES.includes(specifier)) {
        fail(`PREPARATION_EXTERNAL_DEPENDENCY_NOT_ALLOWLISTED:${specifier}`);
      }
    }
  }
}
function payload(manifest) {
  return { schemaVersion: 1, kind: "woolim-preparation-runtime", version: PREPARATION_RUNTIME_VERSION,
    nodeMinimum: "22.6.0", platform: manifest.platform, arch: manifest.arch,
    dependencies: manifest.dependencies, files: manifest.files };
}
function fingerprint(manifest) { return hash(JSON.stringify(payload(manifest))); }
async function requireEmptyOutput(outputRoot) {
  if (!path.isAbsolute(outputRoot)) fail("PREPARATION_PACKAGE_ABSOLUTE_ROOT_REQUIRED");
  await safeRoot(path.dirname(outputRoot));
  try { await mkdir(outputRoot); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  await safeRoot(outputRoot);
  if ((await readdir(outputRoot)).length) fail("PREPARATION_PACKAGE_OUTPUT_NOT_EMPTY");
}

/** No npm command, download, lifecycle script, worker credential or application environment is used. */
export async function packagePreparationRuntime(outputRoot, { sourceRoot = preparationSourceRoot() } = {}) {
  assertPreparationNodeVersion();
  const source = await safeRoot(sourceRoot);
  await assertAllowlistedImportGraph(source);
  await requireEmptyOutput(outputRoot);
  const output = await safeRoot(outputRoot);
  const dependencies = await dependencyRecords(source);
  const sourceFiles = new Set(PREPARATION_RUNTIME_SOURCE_FILES);
  for (const dependency of dependencies) {
    const directory = await safeRoot(path.join(source, dependency.path));
    for (const relative of await tree(directory)) {
      // Nested packages are handled by the explicit dependency closure, not copied indiscriminately.
      if (relative.startsWith("node_modules/")) continue;
      if (/(^|\/)\.env(?:\.|$)/i.test(relative)) fail("PREPARATION_PACKAGE_ENV_FILE_FORBIDDEN");
      sourceFiles.add(`${dependency.path}/${relative}`);
    }
  }
  if (sourceFiles.size > MAX_FILES) fail("PREPARATION_PACKAGE_TOO_MANY_FILES");
  for (const relative of [...sourceFiles].sort()) {
    const from = await safeFile(source, relative);
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(from, destination, 1); // COPYFILE_EXCL: never replace another artifact.
  }
  const generated = { name: "woolim-preparation-runtime", version: PREPARATION_RUNTIME_VERSION, private: true,
    type: "module", engines: { node: ">=22.6.0" }, dependencies: Object.fromEntries(ROOT_DEPENDENCIES.map((name) => {
      const item = dependencies.find((entry) => entry.path === `node_modules/${name}`);
      if (!item) fail("PREPARATION_DEPENDENCY_MISSING");
      return [name, item.version];
    })) };
  await writeFile(path.join(output, "package.json"), `${JSON.stringify(generated, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const files = await Promise.all([...sourceFiles, "package.json"].sort().map((relative) => record(output, relative)));
  if (files.reduce((total, file) => total + file.bytes, 0) > MAX_BYTES) fail("PREPARATION_PACKAGE_TOO_LARGE");
  const manifest = { ...payload({ platform: process.platform, arch: process.arch, dependencies, files }),
    fingerprint: fingerprint({ platform: process.platform, arch: process.arch, dependencies, files }) };
  await writeFile(path.join(output, PREPARATION_RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await inspectPreparationRuntime(output, { expectedFingerprint: manifest.fingerprint });
  return { outputRoot: output, version: manifest.version, fingerprint: manifest.fingerprint,
    fileCount: files.length, dependencyCount: dependencies.length, installed: false };
}

export async function inspectPreparationRuntime(runtimeRoot, { expectedFingerprint, platform = process.platform, arch = process.arch } = {}) {
  assertPreparationNodeVersion();
  if (!SHA256.test(expectedFingerprint ?? "")) fail("PREPARATION_PACKAGE_TRUSTED_FINGERPRINT_REQUIRED");
  const root = await safeRoot(runtimeRoot);
  const manifestPath = await safeFile(root, PREPARATION_RUNTIME_MANIFEST);
  if ((await lstat(manifestPath)).size > 2 * 1024 * 1024) fail("PREPARATION_PACKAGE_MANIFEST_INVALID");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.kind !== "woolim-preparation-runtime"
    || manifest.version !== PREPARATION_RUNTIME_VERSION || manifest.nodeMinimum !== "22.6.0"
    || manifest.platform !== platform || manifest.arch !== arch || !Array.isArray(manifest.files)
    || manifest.files.length > MAX_FILES || !Array.isArray(manifest.dependencies)
    || manifest.fingerprint !== expectedFingerprint || fingerprint(manifest) !== expectedFingerprint) {
    fail("PREPARATION_PACKAGE_MANIFEST_MISMATCH");
  }
  const files = manifest.files;
  const paths = files.map((file) => safeRelative(file.path));
  if (new Set(paths).size !== paths.length || files.some((file) => !SHA256.test(file.sha256)
    || !Number.isSafeInteger(file.bytes) || file.bytes < 0) || files.reduce((sum, file) => sum + file.bytes, 0) > MAX_BYTES) {
    fail("PREPARATION_PACKAGE_MANIFEST_INVALID");
  }
  const required = [...PREPARATION_RUNTIME_SOURCE_FILES, "package.json"];
  if (required.some((file) => !paths.includes(file))) fail("PREPARATION_PACKAGE_SOURCE_MISSING");
  const dependencyRoots = manifest.dependencies.map((dependency) => {
    if (!PACKAGE_NAME.test(dependency.name) || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(dependency.version)
      || safeRelative(dependency.path).split("/node_modules/").some((part, index) => index > 0 && !PACKAGE_NAME.test(part))
      || !dependency.path.startsWith("node_modules/")) fail("PREPARATION_PACKAGE_DEPENDENCY_INVALID");
    return dependency.path;
  });
  if (ROOT_DEPENDENCIES.some((name) => !dependencyRoots.includes(`node_modules/${name}`))) fail("PREPARATION_DEPENDENCY_MISSING");
  if (paths.some((file) => !required.includes(file) && !dependencyRoots.some((prefix) => file.startsWith(`${prefix}/`)))
    || paths.some((file) => /(^|\/)\.env(?:\.|$)/i.test(file))) fail("PREPARATION_PACKAGE_EXTRA_FILE");
  const actual = await tree(root);
  if (JSON.stringify(actual) !== JSON.stringify([...paths, PREPARATION_RUNTIME_MANIFEST].sort())) fail("PREPARATION_PACKAGE_FILE_SET_MISMATCH");
  for (const expected of files) {
    const actualFile = await record(root, expected.path);
    if (actualFile.bytes !== expected.bytes || actualFile.sha256 !== expected.sha256) fail(`PREPARATION_PACKAGE_FILE_MISMATCH:${expected.path}`);
  }
  return { root, version: manifest.version, fingerprint: expectedFingerprint, files, dependencies: manifest.dependencies };
}

/** Copies to an immutable version directory. It does not activate, update a task or remove any previous version. */
export async function stagePreparationRuntime({ packageRoot, runtimeRoot, expectedFingerprint }) {
  const inspected = await inspectPreparationRuntime(packageRoot, { expectedFingerprint });
  if (!path.isAbsolute(runtimeRoot) || path.basename(runtimeRoot) !== "preparation-runtimes") fail("PREPARATION_INSTALL_DEDICATED_ROOT_REQUIRED");
  const relativeToPackage = path.relative(inspected.root, path.resolve(runtimeRoot));
  if (!relativeToPackage || (!relativeToPackage.startsWith(`..${path.sep}`) && relativeToPackage !== ".." && !path.isAbsolute(relativeToPackage))) {
    fail("PREPARATION_INSTALL_ROOT_OVERLAPS_PACKAGE");
  }
  await safeRoot(path.dirname(runtimeRoot));
  await mkdir(runtimeRoot, { recursive: true });
  const root = await safeRoot(runtimeRoot);
  const target = path.join(root, `${inspected.version}-${inspected.fingerprint}`);
  try {
    await lstat(target);
    await inspectPreparationRuntime(target, { expectedFingerprint });
    return { runtimeRoot: target, fingerprint: inspected.fingerprint, staged: true, reused: true, activated: false };
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const temporary = path.join(root, `.stage-${randomUUID()}`);
  await mkdir(temporary);
  for (const relative of [...inspected.files.map((file) => file.path), PREPARATION_RUNTIME_MANIFEST]) {
    const source = await safeFile(inspected.root, relative);
    const destination = path.join(temporary, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, 1);
  }
  await inspectPreparationRuntime(temporary, { expectedFingerprint });
  // Do not delete failed staging directories; the previous runtime is always intact.
  await rename(temporary, target);
  await inspectPreparationRuntime(target, { expectedFingerprint });
  return { runtimeRoot: target, fingerprint: inspected.fingerprint, staged: true, reused: false, activated: false };
}

/** Only OS/font/COM necessities cross into the local worker child. No NODE_OPTIONS, .env, API credentials or secrets. */
export function preparationChildEnvironment(environment = process.env) {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "localappdata",
    "appdata", "userprofile", "programfiles", "programfiles(x86)", "programdata", "commonprogramfiles", "allusersprofile"]);
  return { ...Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === "string")),
    GEMINI_ENABLED: "false", GEMINI_ALLOW_NON_PRODUCTION: "false" };
}

export function preparationLaunchArguments(args) {
  const flags = new Set(["--serve", "--redact", "--prepare-requests"]);
  const values = new Set(["--source", "--work-root", "--select", "--artwork-reviews", "--source-format", "--source-hash", "--reviewed-by", "--format-reason"]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) fail("PREPARATION_LAUNCH_ARGUMENT_INVALID");
    seen.add(flag);
    if (flags.has(flag)) continue;
    if (!values.has(flag) || typeof args[i + 1] !== "string" || !args[i + 1] || args[i + 1].includes("\0")) fail("PREPARATION_LAUNCH_ARGUMENT_INVALID");
    i++;
  }
  if (!seen.has("--source") || !seen.has("--work-root")) fail("PREPARATION_LAUNCH_SOURCE_AND_WORK_ROOT_REQUIRED");
  return [...args];
}
