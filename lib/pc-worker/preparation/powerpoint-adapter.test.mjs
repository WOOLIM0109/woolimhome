import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalPowerPointAdapterError,
  exportLocalPowerPointSlides,
  getLocalPowerPointRuntime,
  getLocalPowerPointConverterFingerprint,
  runPowerPointProcess,
} from "./powerpoint-adapter.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const PROCESS_OK = { exitCode: 0, signal: null, stderr: "" };

test("timeout drains the active checkpoint before rejecting and blocks later callbacks",async()=>{
  let completed=false,callbacks=0,started=false;
  await assert.rejects(runPowerPointProcess({command:process.execPath,
    args:['-e',"console.log('first');setInterval(()=>console.log('later'),20)"],timeoutMs:700,
    onStdoutLine:async()=>{started=true;callbacks++;await new Promise(resolve=>setTimeout(resolve,900));completed=true;}
  }),error=>error instanceof LocalPowerPointAdapterError && error.code==='POWERPOINT_TIMEOUT');
  assert.equal(started,true);assert.equal(completed,true);assert.equal(callbacks,1);
});
test("converter fingerprint covers the local adapter and PowerShell implementation",async()=>{
  assert.match(await getLocalPowerPointConverterFingerprint(),/^[0-9a-f]{64}$/);
});

function requestPathFor(invocation) {
  const index = invocation.args.indexOf("-RequestPath");
  assert.notEqual(index, -1);
  assert.equal(typeof invocation.args[index + 1], "string");
  return invocation.args[index + 1];
}

async function requestFor(invocation) {
  return JSON.parse(await readFile(requestPathFor(invocation), "utf8"));
}

test("reads PowerPoint registration and bilingual font inventory through the JSON-lines protocol", async () => {
  let privateRequestPath = "";
  const runtime = await getLocalPowerPointRuntime({
    scriptPath: path.resolve("tools/woolim-pc-worker/prepare-slides.ps1"),
    runProcess: async (invocation) => {
      assert.equal(invocation.command, "powershell.exe");
      assert.deepEqual(invocation.args.slice(0, 6), [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("tools/woolim-pc-worker/prepare-slides.ps1"),
      ]);
      privateRequestPath = requestPathFor(invocation);
      assert.deepEqual(await requestFor(invocation), { operation: "inventory" });
      await invocation.onStdoutLine("");
      await invocation.onStdoutLine(JSON.stringify({
        type: "complete",
        operation: "inventory",
        available: true,
        powerPointVersion: "16.0.19127.20202",
        registeredClass: "PowerPoint.Application.16",
        fontInventory: {
          familyCount: 2,
          families: [
            { english: "Arial", korean: "Arial" },
            { english: "Malgun Gothic", korean: "맑은 고딕" },
          ],
          fileCount: 4,
          fileListHash: HASH_A,
          fingerprint: HASH_B,
        },
      }));
      return PROCESS_OK;
    },
  });

  assert.deepEqual(runtime, {
    available: true,
    powerPointVersion: "16.0.19127.20202",
    registeredClass: "PowerPoint.Application.16",
    fontInventory: {
      familyCount: 2,
      families: [
        { english: "Arial", korean: "Arial" },
        { english: "Malgun Gothic", korean: "맑은 고딕" },
      ],
      fileCount: 4,
      fileListHash: HASH_A,
      fingerprint: HASH_B,
    },
  });
  await assert.rejects(readFile(privateRequestPath), { code: "ENOENT" });
});

test("creates a unique attempt, exports requested one-based slides, and awaits checkpoints in order", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "powerpoint-adapter-test-"));
  try {
    const sourcePath = path.join(temporaryRoot, "fixture.pptx");
    const outputRoot = path.join(temporaryRoot, "exports");
    await writeFile(sourcePath, "synthetic fixture; the mock runner never opens this file");
    const callbackTrace = [];
    let observedRequest;

    const result = await exportLocalPowerPointSlides({
      sourcePath,
      sourceHash: HASH_A,
      outputDirectory: outputRoot,
      slideNumbers: [7, 2],
      longEdge: 800,
    }, {
      onSlide: async (slide) => {
        callbackTrace.push(`start:${slide.sourceSlideNumber}`);
        await Promise.resolve();
        callbackTrace.push(`end:${slide.sourceSlideNumber}`);
      },
      runProcess: async (invocation) => {
        observedRequest = await requestFor(invocation);
        assert.equal(observedRequest.operation, "export");
        assert.equal(observedRequest.sourcePath, path.resolve(sourcePath));
        assert.equal(observedRequest.sourceHash, HASH_A);
        assert.equal(observedRequest.outputRoot, path.resolve(outputRoot));
        assert.match(
          path.relative(observedRequest.outputRoot, observedRequest.outputDirectory),
          /^attempt-[0-9a-f-]{36}$/,
        );
        assert.deepEqual(observedRequest.slideNumbers, [7, 2]);
        assert.equal(observedRequest.longEdge, 800);

        for (const sourceSlideNumber of observedRequest.slideNumbers) {
          const slidePath = path.join(
            observedRequest.outputDirectory,
            `slide-${String(sourceSlideNumber).padStart(4, "0")}.png`,
          );
          await writeFile(slidePath, Buffer.alloc(2_048, sourceSlideNumber));
          await invocation.onStdoutLine(JSON.stringify({
            type: "slide",
            sourceSlideNumber,
            path: slidePath,
            width: 800,
            height: 450,
          }));
          assert.equal(callbackTrace.at(-1), `end:${sourceSlideNumber}`);
        }
        await invocation.onStdoutLine(JSON.stringify({
          type: "complete",
          operation: "export",
          sourceHash: HASH_A,
          outputDirectory: observedRequest.outputDirectory,
          slideCount: 2,
          sourceSlideNumbers: [7, 2],
          slideWidth: 960,
          slideHeight: 540,
          exportWidth: 800,
          exportHeight: 450,
        }));
        return PROCESS_OK;
      },
    });

    assert.deepEqual(callbackTrace, ["start:7", "end:7", "start:2", "end:2"]);
    assert.equal(result.outputDirectory, observedRequest.outputDirectory);
    assert.deepEqual(result.sourceSlideNumbers, [7, 2]);
    assert.deepEqual(result.slides.map((slide) => slide.sourceSlideNumber), [7, 2]);
    assert.equal(result.exportWidth, 800);
    assert.equal(result.exportHeight, 450);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("preserves structured PowerPoint errors and does not call the slide checkpoint", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "powerpoint-adapter-error-"));
  try {
    const sourcePath = path.join(temporaryRoot, "fixture.pptx");
    await writeFile(sourcePath, "synthetic fixture");
    let callbackCount = 0;
    await assert.rejects(
      exportLocalPowerPointSlides({
        sourcePath,
        sourceHash: HASH_A,
        outputDirectory: path.join(temporaryRoot, "exports"),
        slideNumbers: [1],
        longEdge: 2400,
      }, {
        onSlide: () => { callbackCount += 1; },
        runProcess: async (invocation) => {
          await invocation.onStdoutLine(JSON.stringify({
            type: "error",
            code: "POWERPOINT_BUSY",
            message: "PowerPoint is already running.",
          }));
          return { exitCode: 1, signal: null, stderr: "" };
        },
      }),
      (error) => {
        assert.ok(error instanceof LocalPowerPointAdapterError);
        assert.equal(error.code, "POWERPOINT_BUSY");
        assert.equal(error.message, "PowerPoint is already running.");
        return true;
      },
    );
    assert.equal(callbackCount, 0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects a successful process that omits the final completion record", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "powerpoint-adapter-incomplete-"));
  try {
    const sourcePath = path.join(temporaryRoot, "fixture.pptx");
    await writeFile(sourcePath, "synthetic fixture");
    await assert.rejects(
      exportLocalPowerPointSlides({
        sourcePath,
        sourceHash: HASH_A,
        outputDirectory: path.join(temporaryRoot, "exports"),
        slideNumbers: [4],
        longEdge: 800,
      }, {
        runProcess: async (invocation) => {
          const request = await requestFor(invocation);
          const slidePath = path.join(request.outputDirectory, "slide-0004.png");
          await writeFile(slidePath, Buffer.alloc(2_048));
          await invocation.onStdoutLine(JSON.stringify({
            type: "slide",
            sourceSlideNumber: 4,
            path: slidePath,
            width: 566,
            height: 800,
          }));
          return PROCESS_OK;
        },
      }),
      (error) => error instanceof LocalPowerPointAdapterError && error.code === "MISSING_COMPLETION",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects a reported slide path outside its unique attempt directory", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "powerpoint-adapter-escape-"));
  try {
    const sourcePath = path.join(temporaryRoot, "fixture.pptx");
    const escapedPath = path.join(temporaryRoot, "escaped.png");
    await writeFile(sourcePath, "synthetic fixture");
    await writeFile(escapedPath, Buffer.alloc(2_048));
    await assert.rejects(
      exportLocalPowerPointSlides({
        sourcePath,
        sourceHash: HASH_A,
        outputDirectory: path.join(temporaryRoot, "exports"),
        slideNumbers: [1],
        longEdge: 800,
      }, {
        runProcess: async (invocation) => {
          await invocation.onStdoutLine(JSON.stringify({
            type: "slide",
            sourceSlideNumber: 1,
            path: escapedPath,
            width: 800,
            height: 450,
          }));
          return PROCESS_OK;
        },
      }),
      (error) => error instanceof LocalPowerPointAdapterError && error.code === "OUTPUT_PATH_ESCAPE",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
