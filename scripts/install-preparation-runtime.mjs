import { stagePreparationRuntime } from "./preparation-runtime-package.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--package" || args[2] !== "--runtime-root" || args[4] !== "--expected-fingerprint") {
    console.error("Usage: node scripts/install-preparation-runtime.mjs --package <package> --runtime-root <.../preparation-runtimes> --expected-fingerprint <trusted SHA256>");
    process.exitCode = 2;
  } else {
    stagePreparationRuntime({ packageRoot: args[1], runtimeRoot: args[3], expectedFingerprint: args[5] })
      .then((result) => console.log(JSON.stringify(result))).catch((error) => {
        console.error(error instanceof Error ? error.message : "PREPARATION_STAGING_FAILED");
        process.exitCode = 1;
      });
  }
}
