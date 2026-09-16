import { packagePreparationRuntime } from "./preparation-runtime-package.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") {
  console.error("Usage: node scripts/package-preparation-runtime.mjs --output <empty absolute directory>");
  process.exitCode = 2;
} else {
  packagePreparationRuntime(args[1]).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof Error ? error.message : "PREPARATION_PACKAGE_FAILED");
    process.exitCode = 1;
  });
}
