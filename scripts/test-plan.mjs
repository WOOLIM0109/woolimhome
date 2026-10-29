import { readdir } from "node:fs/promises";
import path from "node:path";

export const SERIAL_POWERPOINT_TEST_FILES = Object.freeze([
  "lib/pc-worker/preparation/powerpoint-adapter.test.mjs",
  "lib/pc-worker/preparation/powerpoint-cleanup.test.mjs",
  "lib/pc-worker/preparation/preparation-review-service.test.mjs",
]);

export async function discoverTestFiles(root) {
  const files = [];
  async function visit(relativeDirectory) {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(relativePath);
    }
  }
  await visit("lib");
  return files.sort();
}

// Keep this conservative: tests using a mocked export still belong in the
// serial group if they name the same entry points as a live converter test.
const powerPointMarker = /\bGetTypeFromProgID\s*\(\s*(['"])PowerPoint\.Application\1\s*\)|\bGetActiveObject\b|\bexportLocalPowerPointSlides\b|\binspectLocalPptx\b/i;

export function validatePowerPointTestFiles(sources, serialFiles = SERIAL_POWERPOINT_TEST_FILES) {
  const registered = new Set();
  const errors = [];
  for (const file of serialFiles) {
    if (registered.has(file)) errors.push(`Duplicate serial PowerPoint test file: ${file}`);
    registered.add(file);
    if (!sources.has(file)) errors.push(`Registered serial PowerPoint test file is missing: ${file}`);
    else if (!powerPointMarker.test(sources.get(file))) {
      errors.push(`Registered serial test file has no PowerPoint source marker: ${file}`);
    }
  }
  for (const [file, source] of sources) {
    if (powerPointMarker.test(source) && !registered.has(file)) {
      errors.push(`PowerPoint test file is missing from the serial list: ${file}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
