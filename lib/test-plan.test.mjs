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

const realConverterReferences = [
  String.raw`const mutex = 'Local\\WoolimPowerPointPreparation';`,
  String.raw`$mutex = 'Local\WoolimPowerPointPreparation';`,
  "const converter = new URL('../tools/prepare-slides.ps1', import.meta.url);",
  String.raw`const converter = 'tools\\prepare-slides.ps1';`,
];

test("serial files that directly use the converter or mutex require the lock helper import", () => {
  const file = "lib/live-converter.test.mjs";
  for (const reference of realConverterReferences) {
    const source = `${markers[0]}\n${reference}`;
    assert.throws(() => validatePowerPointTestFiles(new Map([[file, source]]), [file]), {
      message: `Serial PowerPoint test file runs the real converter without the lock helper: ${file}`,
    });
    assert.throws(() => validatePowerPointTestFiles(new Map([
      [file, `${source}\n// ./powerpoint-test-lock.mjs`],
    ]), [file]), /without the lock helper/);
    assert.throws(() => validatePowerPointTestFiles(new Map([
      [file, `${source}\n// import('./powerpoint-test-lock.mjs');`],
    ]), [file]), /without the lock helper/);
  }
});

test("real converter tests accept static and dynamic lock helper imports", () => {
  const file = "lib/live-converter.test.mjs";
  const imports = [
    "import { runWhenPowerPointFree } from './powerpoint-test-lock.mjs';",
    'import {\n runWhenPowerPointFree,\n} from "./powerpoint-test-lock.mjs";',
    "import './powerpoint-test-lock.mjs';",
    "const helper = await import('./powerpoint-test-lock.mjs');",
  ];
  for (const reference of realConverterReferences) {
    for (const helperImport of imports) {
      validatePowerPointTestFiles(new Map([
        [file, `${helperImport}\n${markers[0]}\n${reference}`],
      ]), [file]);
    }
  }
});

test("mocked converter entry points do not require a lock helper import", () => {
  const file = "lib/mock-converter.test.mjs";
  for (const marker of markers) {
    validatePowerPointTestFiles(new Map([[file, marker]]), [file]);
  }
});

test("converter paths inside injected process options remain mocked while separate live paths need a helper", () => {
  const file = "lib/mock-converter.test.mjs";
  const mocked = `${markers[0]}
    getRuntime({
      scriptPath: path.resolve('tools/prepare-slides.ps1'),
      runProcess: async invocation => {
        assert.equal(invocation.path, path.resolve('tools/prepare-slides.ps1'));
      },
    });`;
  validatePowerPointTestFiles(new Map([[file, mocked]]), [file]);
  assert.throws(() => validatePowerPointTestFiles(new Map([
    [file, `${mocked}\nconst livePath = new URL('./prepare-slides.ps1', import.meta.url);`],
  ]), [file]), /without the lock helper/);
  assert.throws(() => validatePowerPointTestFiles(new Map([
    [file, `${mocked}\n${realConverterReferences[0]}`],
  ]), [file]), /without the lock helper/);
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
