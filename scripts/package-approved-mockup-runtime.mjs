import { copyFile, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

import {
  APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES,
  approvedMockupRuntimeFilePath,
  approvedMockupSourceRuntimeRoot,
  inspectApprovedMockupRuntime,
  writeApprovedMockupRuntimeManifest,
} from "../lib/portfolio/approved-mockup-runtime.ts";

const GENERATED_PACKAGE_JSON = {
  name: "woolim-approved-mockup-runtime",
  private: true,
  type: "module",
  engines: { node: ">=22.6" },
  dependencies: { sharp: sharp.versions.sharp },
};

function fail(message) {
  throw new Error(message);
}

async function requireEmptyOutput(outputRoot) {
  if (!path.isAbsolute(outputRoot)) fail("RUNTIME_PACKAGE_OUTPUT_MUST_BE_ABSOLUTE");
  try {
    const info = await lstat(outputRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("RUNTIME_PACKAGE_OUTPUT_NOT_DIRECTORY");
    if ((await readdir(outputRoot)).length > 0) fail("RUNTIME_PACKAGE_OUTPUT_NOT_EMPTY");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    await mkdir(outputRoot, { recursive: false });
  }
}

/**
 * Creates an uninstalled, fixed-allowlist renderer payload. It deliberately
 * excludes node_modules, environment files and customer work. Installation and
 * worker activation are separate, explicit later steps.
 */
export async function packageApprovedMockupRuntime(outputRoot) {
  if (!path.isAbsolute(outputRoot)) fail("RUNTIME_PACKAGE_OUTPUT_MUST_BE_ABSOLUTE");
  const targetRoot = path.normalize(outputRoot);
  await requireEmptyOutput(targetRoot);
  const sourceRoot = approvedMockupSourceRuntimeRoot();
  for (const relativePath of APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES) {
    if (relativePath === "package.json") continue;
    const source = approvedMockupRuntimeFilePath(relativePath, sourceRoot);
    const destination = approvedMockupRuntimeFilePath(relativePath, targetRoot);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await writeFile(
    approvedMockupRuntimeFilePath("package.json", targetRoot),
    `${JSON.stringify(GENERATED_PACKAGE_JSON, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const manifest = await writeApprovedMockupRuntimeManifest(targetRoot);
  await inspectApprovedMockupRuntime({
    runtimeRoot: targetRoot,
    requireManifest: true,
    requiredPaths: APPROVED_MOCKUP_RUNTIME_PACKAGE_FILES,
  });
  return { outputRoot: targetRoot, fileCount: manifest.files.length,
    runtimeFingerprint: manifest.runtimeFingerprint, installed: false };
}

function outputArgument(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    fail("사용법: node --experimental-strip-types scripts/package-approved-mockup-runtime.mjs --output <빈 절대 경로>");
  }
  return args[1];
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  packageApprovedMockupRuntime(outputArgument(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "RUNTIME_PACKAGE_FAILED");
      process.exitCode = 1;
    });
}
