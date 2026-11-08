import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import {
  packagePreparationRuntime,
  PREPARATION_RUNTIME_MANIFEST,
} from "./preparation-runtime-package.mjs";

/** Creates local release artifacts only. Uploading and approving them is a separate human action. */
export async function publishPreparationRuntime(outputRoot) {
  if (typeof outputRoot !== "string" || !path.isAbsolute(outputRoot)) {
    throw new Error("PREPARATION_PACKAGE_ABSOLUTE_ROOT_REQUIRED");
  }
  try { await mkdir(outputRoot); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  if ((await readdir(outputRoot)).length) throw new Error("PREPARATION_PACKAGE_OUTPUT_NOT_EMPTY");

  // The package builder validates the output ancestry and produces the unchanged runtime payload.
  const packaged = await packagePreparationRuntime(path.join(outputRoot, "runtime"));
  const manifestBytes = await readFile(path.join(packaged.outputRoot, PREPARATION_RUNTIME_MANIFEST));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const archive = new JSZip();
  const options = { date: new Date("1980-01-01T00:00:00Z"), createFolders: false };
  archive.file(PREPARATION_RUNTIME_MANIFEST, manifestBytes, options);
  for (const file of manifest.files) {
    archive.file(file.path, await readFile(path.join(packaged.outputRoot, file.path)), options);
  }
  // The manifest and runtime files live directly at the ZIP root for Expand-Archive.
  const archivePath = path.join(path.dirname(packaged.outputRoot),
    `preparation-runtime-${packaged.version}-${packaged.fingerprint.slice(0, 8)}.zip`);
  const hash = createHash("sha256");
  const hashing = new Transform({
    transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); },
  });
  await pipeline(archive.generateNodeStream({
    type: "nodebuffer", streamFiles: true, platform: "DOS", compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }), hashing, createWriteStream(archivePath, { flags: "wx", mode: 0o600 }));
  return { fingerprint: packaged.fingerprint, archiveSha256: hash.digest("hex"), archivePath,
    version: packaged.version, packageRoot: packaged.outputRoot };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output") {
    console.error("Usage: node scripts/publish-preparation-runtime.mjs --output <empty absolute directory>");
    process.exitCode = 2;
  } else {
    publishPreparationRuntime(args[1]).then((result) => console.log(JSON.stringify(result))).catch((error) => {
      console.error(error instanceof Error ? error.message : "PREPARATION_ARCHIVE_CREATE_FAILED");
      process.exitCode = 1;
    });
  }
}
