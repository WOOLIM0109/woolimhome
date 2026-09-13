import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPreparationRuntime, preparationChildEnvironment, preparationLaunchArguments } from "./preparation-runtime-package.mjs";

export async function launchPreparationRuntime({ expectedFingerprint, args, checkOnly = false }) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const inspected = await inspectPreparationRuntime(root, { expectedFingerprint });
  // The imports intentionally happen only after complete immutable-package verification.
  const sharp = (await import("sharp")).default;
  const xml = await import("@xmldom/xmldom");
  if (typeof xml.DOMParser !== "function" || sharp.versions.sharp !== inspected.dependencies.find((entry) => entry.name === "sharp")?.version) {
    throw new Error("PREPARATION_RUNTIME_DEPENDENCIES_INVALID");
  }
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  if (checkOnly) return { version: inspected.version, fingerprint: inspected.fingerprint, ready: true, started: false };
  const safeArgs = preparationLaunchArguments(args);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", path.join(root, "scripts", "prepare-portfolio-local.mjs"), ...safeArgs], {
      cwd: root, env: preparationChildEnvironment(), stdio: "inherit", windowsHide: true, shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ exitCode: code ?? 1, signal }));
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 3 && args[2] === "--check";
  if (args[0] !== "--expected-fingerprint" || (!checkOnly && args[2] !== "--")) {
    console.error("Usage: node <runtime>/scripts/run-preparation-runtime.mjs --expected-fingerprint <trusted SHA256> (--check | -- <prepare-local arguments>)");
    process.exitCode = 2;
  } else {
    launchPreparationRuntime({ expectedFingerprint: args[1], args: args.slice(3), checkOnly }).then((result) => {
      if (checkOnly) console.log(JSON.stringify(result));
      else process.exitCode = result.exitCode;
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : "PREPARATION_RUNTIME_FAILED");
      process.exitCode = 1;
    });
  }
}
