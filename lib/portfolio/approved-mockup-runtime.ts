import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const APPROVED_MOCKUP_RUNTIME_MANIFEST_NAME =
  "approved-mockup-runtime-manifest.json" as const;
export const APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION = 1 as const;
export const APPROVED_MOCKUP_RUNTIME_KIND = "woolim-approved-mockup-runtime" as const;

export const APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES = [
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
] as const;

export const APPROVED_MOCKUP_RUNTIME_ASSET_FILES = [
  "public/fonts/Paperlogy-7Bold.ttf",
  "public/images/mockup-templates/a4-portrait-dark-wood.png",
  "public/images/woolim-logo-cropped.png",
] as const;

export const APPROVED_MOCKUP_RUNTIME_PACKAGE_METADATA_FILES = ["package.json"] as const;

export const APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES = [
  ...APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES,
  ...APPROVED_MOCKUP_RUNTIME_ASSET_FILES,
  ...APPROVED_MOCKUP_RUNTIME_PACKAGE_METADATA_FILES,
] as const;

export type ApprovedMockupRuntimeFileKind = "implementation" | "asset" | "metadata";
export type ApprovedMockupRuntimeFileRecord = Readonly<{
  path: string;
  kind: ApprovedMockupRuntimeFileKind;
  bytes: number;
  sha256: string;
}>;

export type ApprovedMockupRuntimeManifest = Readonly<{
  schemaVersion: typeof APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION;
  kind: typeof APPROVED_MOCKUP_RUNTIME_KIND;
  files: readonly ApprovedMockupRuntimeFileRecord[];
  sharpVersions: Readonly<Record<string, string>>;
  runtimeFingerprint: string;
}>;

export type InspectedApprovedMockupRuntime = Readonly<{
  root: string;
  packaged: boolean;
  files: readonly ApprovedMockupRuntimeFileRecord[];
  sharpVersions: Readonly<Record<string, string>>;
  runtimeFingerprint: string;
}>;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalSharpVersions() {
  return Object.fromEntries(
    Object.entries(sharp.versions)
      .map(([name, version]) => [name, String(version)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function canonicalManifestPayload(input: {
  files: readonly ApprovedMockupRuntimeFileRecord[];
  sharpVersions: Readonly<Record<string, string>>;
}) {
  return JSON.stringify({
    schemaVersion: APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION,
    kind: APPROVED_MOCKUP_RUNTIME_KIND,
    files: [...input.files].sort((left, right) => left.path.localeCompare(right.path)),
    sharpVersions: Object.fromEntries(
      Object.entries(input.sharpVersions).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
}

function normalizeRuntimeRelativePath(relativePath: string) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_INVALID_PATH");
  }
  const slashPath = relativePath.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-z]:/i.test(slashPath)) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_INVALID_PATH");
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_INVALID_PATH");
  }
  return normalized;
}

function absoluteRuntimeRoot(runtimeRoot?: string) {
  if (runtimeRoot !== undefined && !runtimeRoot) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_ROOT_MUST_BE_ABSOLUTE");
  }
  const root = runtimeRoot ?? fileURLToPath(new URL("../../", import.meta.url));
  if (!path.isAbsolute(root)) throw new Error("APPROVED_MOCKUP_RUNTIME_ROOT_MUST_BE_ABSOLUTE");
  return path.resolve(root);
}

function lexicalRuntimeFile(runtimeRoot: string, relativePath: string) {
  const normalized = normalizeRuntimeRelativePath(relativePath);
  const resolved = path.resolve(runtimeRoot, ...normalized.split("/"));
  const relative = path.relative(runtimeRoot, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_INVALID_PATH");
  }
  return { normalized, resolved };
}

async function safeRuntimeFile(runtimeRoot: string, relativePath: string) {
  const rootRealPath = await realpath(runtimeRoot);
  const target = lexicalRuntimeFile(rootRealPath, relativePath);
  const stats = await lstat(target.resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`APPROVED_MOCKUP_RUNTIME_INVALID_FILE:${target.normalized}`);
  }
  const targetRealPath = await realpath(target.resolved);
  const relative = path.relative(rootRealPath, targetRealPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`APPROVED_MOCKUP_RUNTIME_INVALID_FILE:${target.normalized}`);
  }
  return { normalized: target.normalized, absolutePath: targetRealPath };
}

function kindFor(relativePath: string): ApprovedMockupRuntimeFileKind {
  if (relativePath.startsWith("public/")) return "asset";
  if (relativePath.startsWith("lib/")) return "implementation";
  return "metadata";
}

async function recordRuntimeFile(runtimeRoot: string, relativePath: string) {
  const file = await safeRuntimeFile(runtimeRoot, relativePath);
  const bytes = await readFile(file.absolutePath);
  return {
    path: file.normalized,
    kind: kindFor(file.normalized),
    bytes: bytes.length,
    sha256: sha256(bytes),
  } satisfies ApprovedMockupRuntimeFileRecord;
}

function parseManifest(value: unknown): ApprovedMockupRuntimeManifest {
  if (!value || typeof value !== "object") throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
  const input = value as Partial<ApprovedMockupRuntimeManifest>;
  if (input.schemaVersion !== APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION
    || input.kind !== APPROVED_MOCKUP_RUNTIME_KIND
    || !Array.isArray(input.files)
    || !input.sharpVersions || typeof input.sharpVersions !== "object"
    || typeof input.runtimeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.runtimeFingerprint)) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
  }
  const seen = new Set<string>();
  const files = input.files.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
    const file = candidate as Partial<ApprovedMockupRuntimeFileRecord>;
    const normalized = normalizeRuntimeRelativePath(String(file.path || ""));
    if (seen.has(normalized) || !["implementation", "asset", "metadata"].includes(String(file.kind))
      || !Number.isSafeInteger(file.bytes) || (file.bytes || 0) < 1
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
    }
    seen.add(normalized);
    return { path: normalized, kind: file.kind!, bytes: file.bytes!, sha256: file.sha256 };
  });
  const sharpVersions = Object.fromEntries(Object.entries(input.sharpVersions).map(([name, version]) => {
    if (!name || typeof version !== "string" || !version) {
      throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
    }
    return [name, version];
  }));
  const payload = canonicalManifestPayload({ files, sharpVersions });
  if (sha256(payload) !== input.runtimeFingerprint) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_FINGERPRINT_MISMATCH");
  }
  return { schemaVersion: APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION,
    kind: APPROVED_MOCKUP_RUNTIME_KIND, files, sharpVersions,
    runtimeFingerprint: input.runtimeFingerprint };
}

export function approvedMockupSourceRuntimeRoot() {
  return absoluteRuntimeRoot();
}

export function approvedMockupPublicAssetRelativePath(assetPath: string) {
  if (typeof assetPath !== "string" || !assetPath.startsWith("/")) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_INVALID_ASSET_PATH");
  }
  return normalizeRuntimeRelativePath(`public/${assetPath.replace(/^[/\\]+/, "")}`);
}

/**
 * Returns a path within an explicit runtime root. High-level packaged renders
 * validate the package manifest before any of these files are used.
 */
export function approvedMockupRuntimeFilePath(relativePath: string, runtimeRoot?: string) {
  return lexicalRuntimeFile(absoluteRuntimeRoot(runtimeRoot), relativePath).resolved;
}

export function approvedMockupAssetPath(assetPath: string, runtimeRoot?: string) {
  return approvedMockupRuntimeFilePath(
    approvedMockupPublicAssetRelativePath(assetPath),
    runtimeRoot,
  );
}

export async function createApprovedMockupRuntimeManifest(runtimeRoot: string) {
  const root = absoluteRuntimeRoot(runtimeRoot);
  const files = await Promise.all(APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES.map(
    (relativePath) => recordRuntimeFile(root, relativePath),
  ));
  files.sort((left, right) => left.path.localeCompare(right.path));
  const sharpVersions = canonicalSharpVersions();
  const runtimeFingerprint = sha256(canonicalManifestPayload({ files, sharpVersions }));
  return { schemaVersion: APPROVED_MOCKUP_RUNTIME_MANIFEST_VERSION,
    kind: APPROVED_MOCKUP_RUNTIME_KIND, files, sharpVersions,
    runtimeFingerprint } satisfies ApprovedMockupRuntimeManifest;
}

export async function writeApprovedMockupRuntimeManifest(runtimeRoot: string) {
  const root = absoluteRuntimeRoot(runtimeRoot);
  const manifest = await createApprovedMockupRuntimeManifest(root);
  const target = approvedMockupRuntimeFilePath(APPROVED_MOCKUP_RUNTIME_MANIFEST_NAME, root);
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return manifest;
}

export async function inspectApprovedMockupRuntime(input: {
  runtimeRoot?: string;
  requireManifest?: boolean;
  requiredPaths: readonly string[];
}): Promise<InspectedApprovedMockupRuntime> {
  const root = absoluteRuntimeRoot(input.runtimeRoot);
  const requested = [...new Set(input.requiredPaths.map(normalizeRuntimeRelativePath))].sort();
  let manifest: ApprovedMockupRuntimeManifest | null = null;
  try {
    const safeManifest = await safeRuntimeFile(root, APPROVED_MOCKUP_RUNTIME_MANIFEST_NAME);
    const bytes = await readFile(safeManifest.absolutePath);
    if (bytes.length > 1024 * 1024) throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_INVALID");
    manifest = parseManifest(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "ENOENT" || input.requireManifest) {
      if (code === "ENOENT") throw new Error("APPROVED_MOCKUP_RUNTIME_MANIFEST_REQUIRED");
      throw error;
    }
  }
  const sharpVersions = canonicalSharpVersions();
  let files: ApprovedMockupRuntimeFileRecord[];
  if (manifest) {
    const expectedPackagePaths = [...APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES].sort();
    const manifestPaths = manifest.files.map((file) => file.path).sort();
    if (JSON.stringify(expectedPackagePaths) !== JSON.stringify(manifestPaths)) {
      throw new Error("APPROVED_MOCKUP_RUNTIME_PACKAGE_FILE_SET_MISMATCH");
    }
    if (JSON.stringify(manifest.sharpVersions) !== JSON.stringify(sharpVersions)) {
      throw new Error("APPROVED_MOCKUP_RUNTIME_SHARP_VERSION_MISMATCH");
    }
    const verifiedPackageFiles = await Promise.all(expectedPackagePaths.map(
      (relativePath) => recordRuntimeFile(root, relativePath),
    ));
    const expected = new Map(manifest.files.map((file) => [file.path, file]));
    for (const file of verifiedPackageFiles) {
      const match = expected.get(file.path);
      if (!match || match.kind !== file.kind || match.bytes !== file.bytes || match.sha256 !== file.sha256) {
        throw new Error(`APPROVED_MOCKUP_RUNTIME_FILE_MISMATCH:${file.path}`);
      }
    }
    const verified = new Map(verifiedPackageFiles.map((file) => [file.path, file]));
    files = requested.map((relativePath) => {
      const file = verified.get(relativePath);
      if (!file) throw new Error(`APPROVED_MOCKUP_RUNTIME_FILE_NOT_PACKAGED:${relativePath}`);
      return file;
    });
  } else {
    files = await Promise.all(requested.map((relativePath) => recordRuntimeFile(root, relativePath)));
  }
  const runtimeFingerprint = manifest?.runtimeFingerprint
    || sha256(canonicalManifestPayload({ files, sharpVersions }));
  return { root, packaged: Boolean(manifest), files, sharpVersions, runtimeFingerprint };
}
