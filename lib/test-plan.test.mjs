import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverTestFiles,
  SERIAL_POWERPOINT_TEST_FILES,
  validatePowerPointTestFiles,
} from "../scripts/test-plan.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
// Build fixture tokens so source scanning does not classify this registry test
// itself as a converter test.
const registrationName = "Get" + "TypeFromProgID";
const applicationName = ["PowerPoint", "Application"].join(".");
const activeObjectName = "Get" + "ActiveObject";
const exportName = "exportLocal" + "PowerPointSlides";
const inspectionName = "inspectLocal" + "Pptx";
const markers = [
  `${registrationName}('${applicationName}')`,
  `${registrationName}("${applicationName}")`,
  `${registrationName} ( \n '${applicationName}' \n )`,
  `${activeObjectName}("${applicationName}")`,
  `${exportName}({ sourcePath })`,
  `${inspectionName}(sourcePath)`,
];

test("serial PowerPoint registry matches source markers in every repository test file", async () => {
  const files = await discoverTestFiles(repositoryRoot);
  const sources = new Map(await Promise.all(files.map(async file => [
    file, await readFile(path.join(repositoryRoot, file), "utf8"),
  ])));
  validatePowerPointTestFiles(sources);
  assert.equal(Object.isFrozen(SERIAL_POWERPOINT_TEST_FILES), true);
});

test("each converter source marker rejects an unregistered test file", () => {
  const file = "lib/new-converter.test.mjs";
  for (const source of markers) {
    assert.throws(() => validatePowerPointTestFiles(new Map([[file, source]]), []), {
      message: `PowerPoint test file is missing from the serial list: ${file}`,
    });
  }
});

test("registered test files without converter source markers are rejected", () => {
  const file = "lib/former-converter.test.mjs";
  assert.throws(() => validatePowerPointTestFiles(new Map([[file, "test('plain test', () => {});"]]), [file]), {
    message: `Registered serial test file has no PowerPoint source marker: ${file}`,
  });
});

test("missing files and duplicate serial entries are rejected", () => {
  const file = "lib/missing-converter.test.mjs";
  assert.throws(() => validatePowerPointTestFiles(new Map(), [file]), {
    message: `Registered serial PowerPoint test file is missing: ${file}`,
  });
  assert.throws(() => validatePowerPointTestFiles(new Map([[file, markers[0]]]), [file, file]), {
    message: `Duplicate serial PowerPoint test file: ${file}`,
  });
});

test("registry reports unregistered and obsolete entries together", () => {
  const stale = "lib/old-converter.test.mjs", added = "lib/new-converter.test.mjs";
  assert.throws(() => validatePowerPointTestFiles(new Map([
    [stale, "test('plain test', () => {});"], [added, markers[0]],
  ]), [stale]), error => {
    assert.match(error.message, /old-converter\.test\.mjs/);
    assert.match(error.message, /new-converter\.test\.mjs/);
    return true;
  });
});

test("matching serial files and ordinary parallel tests are accepted", () => {
  const serial = "lib/converter.test.mjs", ordinary = "lib/plain.test.mjs";
  validatePowerPointTestFiles(new Map([[serial, markers[0]], [ordinary, "test('plain', () => {});"]]), [serial]);
});

test("test discovery includes every nested mjs test under lib in sorted slash paths", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "test-plan-"));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith("test-plan-"));
    await rm(target, { recursive: true, force: true });
  });
  const fixtures = ["lib/z.test.mjs", "lib/nested/a.test.mjs", "lib/nested/deep/b.test.mjs",
    "lib/helper.mjs", "lib/other.test.js", "scripts/outside.test.mjs"];
  for (const file of fixtures) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "");
  }
  assert.deepEqual(await discoverTestFiles(root), [
    "lib/nested/a.test.mjs", "lib/nested/deep/b.test.mjs", "lib/z.test.mjs",
  ]);
});
