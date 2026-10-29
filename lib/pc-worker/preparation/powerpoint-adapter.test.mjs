import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  LocalPowerPointAdapterError,
  exportLocalPowerPointSlides,
  getLocalPowerPointRuntime,
  getLocalPowerPointConverterFingerprint,
  POWERPOINT_PIPE_DRAIN_TIMEOUT_MS,
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
test("cleanup failure closes inherited pipes and rejects without abandoning a running checkpoint", { timeout: 5_000 }, async()=>{
  let ownedChildPid=null,checkpointDone=false;
  const cleanupError=new LocalPowerPointAdapterError('POWERPOINT_CLEANUP_FAILED','Synthetic cleanup refusal');
  try{
    await assert.rejects(runPowerPointProcess({command:process.execPath,
      args:['-e',"const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2],windowsHide:true});child.unref();console.log(child.pid);setTimeout(()=>process.exit(2),100)"],
      timeoutMs:2_000,cleanup:async()=>{throw cleanupError;},
      onStdoutLine:async line=>{ownedChildPid=Number(line);await new Promise(resolve=>setTimeout(resolve,300));checkpointDone=true;}
    }),error=>{
      assert.equal(error.code,'POWERPOINT_PROCESS_FAILED');
      assert.equal(error.cleanupError,cleanupError);
      assert.match(error.message,/code 2/);
      assert.match(error.message,/Synthetic cleanup refusal/);
      return true;
    });
    assert.equal(checkpointDone,true);assert.ok(Number.isSafeInteger(ownedChildPid)&&ownedChildPid>0);
  }finally{if(ownedChildPid){try{process.kill(ownedChildPid);}catch(error){if(error.code!=='ESRCH')throw error;}}}
});
test("successful host exit drains queued records through a delayed checkpoint before cleanup settles",async()=>{
  const records=[];let cleaned=false;
  const result=await runPowerPointProcess({command:process.execPath,args:['-e',"console.log('first\\nsecond\\nthird')"],timeoutMs:2_000,
    cleanup:async()=>{cleaned=true;},onStdoutLine:async line=>{records.push(line);if(line==='first')await new Promise(resolve=>setTimeout(resolve,150));}
  });
  assert.equal(result.exitCode,0);assert.equal(cleaned,true);assert.deepEqual(records,['first','second','third']);
});
test("checkpoint failure keeps its cause when bounded cleanup outlasts the export deadline",async()=>{
  const checkpointError=new Error('SYNTHETIC_CHECKPOINT_FAILURE');let cleaned=false;
  await assert.rejects(runPowerPointProcess({command:process.execPath,args:['-e',"console.log('checkpoint');setInterval(()=>{},1000)"],timeoutMs:2_000,
    onStdoutLine:async()=>{throw checkpointError;},cleanup:async()=>{await new Promise(resolve=>setTimeout(resolve,2_400));cleaned=true;}
  }),error=>error===checkpointError);
  assert.equal(cleaned,true);
});

test("original checkpoint and timeout errors retain cleanup failure details", async () => {
  for (const mode of ['checkpoint', 'timeout']) {
    const primary = new LocalPowerPointAdapterError('SLIDE_EXPORT_FAILED', 'Synthetic slide export failure');
    const cleanupError = new LocalPowerPointAdapterError('POWERPOINT_CLEANUP_FAILED', 'Synthetic owner verification refused');
    let cleanupCalls = 0;
    await assert.rejects(runPowerPointProcess({
      command: process.execPath,
      args: ['-e', "console.log('checkpoint');setInterval(()=>{},1000)"],
      timeoutMs: 700,
      onStdoutLine: async () => { if (mode === 'checkpoint') throw primary; },
      cleanup: async () => { cleanupCalls++; throw cleanupError; },
    }), error => {
      if (mode === 'checkpoint') assert.equal(error, primary);
      assert.equal(error.code, mode === 'timeout' ? 'POWERPOINT_TIMEOUT' : 'SLIDE_EXPORT_FAILED');
      assert.equal(error.cleanupError, cleanupError);
      assert.match(error.message, /Synthetic owner verification refused/);
      return true;
    });
    assert.equal(cleanupCalls, 1);
  }
});

test("successful export host reports cleanup-only failure", async () => {
  const cleanupError = new LocalPowerPointAdapterError('POWERPOINT_CLEANUP_FAILED', 'Synthetic cleanup-only failure');
  await assert.rejects(runPowerPointProcess({
    command: process.execPath, args: ['-e', "console.log('complete')"],
    timeoutMs: 2_000, onStdoutLine: async () => {}, cleanup: async () => { throw cleanupError; },
  }), error => error === cleanupError);
});

function exitedHostWithOpenPipes(t) {
  // Drive the OS event order directly: Node descendants on Windows can close
  // their parent's pipe at exit instead of retaining it like an Office server.
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { throw new Error('The exited host must not be killed'); };
  const close = () => {
    if (child.stdout.destroyed && child.stderr.destroyed) child.emit('close', child.exitCode, null);
  };
  child.stdout.once('close', close);
  child.stderr.once('close', close);
  const spawnMock = t.mock.method(childProcess, 'spawn', () => {
    setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, null); });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawnMock.mock.restore();
    syncBuiltinESMExports();
    child.stdout.destroy();
    child.stderr.destroy();
  });
  return child;
}

test("host exit drains the final complete record and stderr before closing pipes", { timeout: 5_000 }, async t => {
  const child = exitedHostWithOpenPipes(t);
  const records = [];
  child.once('exit', () => setTimeout(() => {
    child.stdout.end('{"type":"slide","sourceSlideNumber":9}\n{"type":"complete","operation":"export"}\n');
    child.stderr.end('final stderr');
  }, 50));
  const result = await runPowerPointProcess({
    command: 'synthetic-host', args: [], timeoutMs: 3_000, cleanup: async () => {},
    onStdoutLine: async line => { records.push(JSON.parse(line)); await new Promise(resolve => setTimeout(resolve, 50)); },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(records, [{ type: 'slide', sourceSlideNumber: 9 }, { type: 'complete', operation: 'export' }]);
  assert.match(result.stderr, /final stderr/);
});

test("cleanup failure waits for the original error still arriving after host exit", { timeout: 5_000 }, async t => {
  const child = exitedHostWithOpenPipes(t);
  const primary = new LocalPowerPointAdapterError('POWERPOINT_OPEN_FAILED', 'Synthetic source open failure');
  const cleanupError = new LocalPowerPointAdapterError('POWERPOINT_CLEANUP_FAILED', 'Synthetic cleanup refusal');
  child.once('exit', () => setTimeout(() => {
    child.stdout.end('{"type":"error"}\n');
    child.stderr.end();
  }, 50));
  await assert.rejects(runPowerPointProcess({
    command: 'synthetic-host', args: [], timeoutMs: 3_000,
    cleanup: async () => { throw cleanupError; },
    onStdoutLine: async () => { throw primary; },
  }), error => {
    assert.equal(error, primary);
    assert.equal(error.cleanupError, cleanupError);
    return true;
  });
});

test("inherited stdout and stderr are cut off within the drain bound for export and helper hosts", { timeout: 10_000 }, async t => {
  for (const host of ['export', 'helper', 'pending cleanup']) await t.test(host, async t => {
    const child = exitedHostWithOpenPipes(t);
    const started = performance.now();
    let pipesClosedAt;
    child.stderr.once('close', () => { pipesClosedAt = performance.now(); });
    const cleanup = async () => {
      if (host !== 'pending cleanup') return;
      await new Promise(resolve => setTimeout(resolve, POWERPOINT_PIPE_DRAIN_TIMEOUT_MS + 300));
      assert.ok(child.stdout.destroyed && child.stderr.destroyed, 'pipe drain must not wait for cleanup');
    };
    const result = await runPowerPointProcess({
      command: 'synthetic-host', args: [], timeoutMs: 4_000,
      ...(host === 'helper' ? { closePipesOnExit: true } : { cleanup }),
      onStdoutLine: async () => {},
    });
    const elapsed = performance.now() - started;
    assert.equal(result.exitCode, 0);
    assert.ok(child.stdout.destroyed && child.stderr.destroyed);
    assert.ok(pipesClosedAt - started < POWERPOINT_PIPE_DRAIN_TIMEOUT_MS + 500, String(pipesClosedAt - started));
    assert.ok(elapsed >= POWERPOINT_PIPE_DRAIN_TIMEOUT_MS - 100, String(elapsed));
    assert.ok(elapsed < POWERPOINT_PIPE_DRAIN_TIMEOUT_MS + 1_000, String(elapsed));
  });
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
