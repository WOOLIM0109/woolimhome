import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseTestRunnerArguments, runTestGroups } from "../scripts/run-tests.mjs";

const execute = promisify(execFile);
const runnerUrl = new URL("../scripts/run-tests.mjs", import.meta.url).href;

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "test runner "));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith("test runner "));
    await rm(target, { recursive: true, force: true });
  });
  return root;
}

test("test runner separates every file and waits for the parallel group before serial execution", async () => {
  const files = ["lib/unit.test.mjs", "lib/office-a.test.mjs", "lib/nested/unit.test.mjs", "lib/office-b.test.mjs"];
  const calls = [];
  let firstFinished = false;
  const code = await runTestGroups(files, {
    cwd: "fixture root",
    serialFiles: [files[1], files[3]],
    log: () => {},
    runGroup: async (args, options) => {
      if (calls.length === 0) {
        calls.push({ args, options });
        await new Promise((resolve) => setImmediate(resolve));
        firstFinished = true;
      } else {
        assert.equal(firstFinished, true);
        calls.push({ args, options });
      }
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map(({ args, options }) => ({ args, cwd: options.cwd })), [
    { args: ["--test", files[0], files[2]], cwd: "fixture root" },
    { args: ["--test", "--test-concurrency=1", files[1], files[3]], cwd: "fixture root" },
  ]);
  assert.equal(calls[0].options.env.WOOLIM_TEST_LOCK_REPORT, calls[1].options.env.WOOLIM_TEST_LOCK_REPORT);
  assert.equal(path.isAbsolute(calls[0].options.env.WOOLIM_TEST_LOCK_REPORT), true);
  assert.deepEqual({ ...calls[0].options.env, WOOLIM_TEST_LOCK_REPORT: undefined }, {
    ...process.env, WOOLIM_TEST_LOCK_REPORT: undefined,
  });
  await assert.rejects(stat(path.dirname(calls[0].options.env.WOOLIM_TEST_LOCK_REPORT)), { code: "ENOENT" });
});

test("test runner runs both real child groups and returns failure if either group fails", async (t) => {
  const root = await fixture(t);
  const files = ["parallel.test.mjs", "serial first.test.mjs", "serial second.test.mjs"];
  for (const [firstFails, secondFails] of [[false, false], [true, false], [false, true], [true, true]]) {
    await t.test(`parallel=${firstFails ? "fail" : "pass"}, serial=${secondFails ? "fail" : "pass"}`, async () => {
      const eventsPath = path.join(root, "events.txt");
      await writeFile(eventsPath, "");
      const common = `import assert from 'node:assert/strict';
        import { appendFileSync, readFileSync } from 'node:fs';
        import test from 'node:test';
        const events = ${JSON.stringify(eventsPath)};`;
      await writeFile(path.join(root, files[0]), `${common}
        test('parallel fixture', () => {
          appendFileSync(events, 'parallel\\n');
          assert.equal(${firstFails}, false, 'PARALLEL_FAILURE');
        });`);
      await writeFile(path.join(root, files[1]), `${common}
        test('serial first fixture', async () => {
          assert.equal(readFileSync(events, 'utf8'), 'parallel\\n');
          await new Promise(resolve => setTimeout(resolve, 80));
          appendFileSync(events, 'serial-first\\n');
          assert.equal(${secondFails}, false, 'SERIAL_FAILURE');
        });`);
      await writeFile(path.join(root, files[2]), `${common}
        test('serial second fixture', () => {
          assert.equal(readFileSync(events, 'utf8'), 'parallel\\nserial-first\\n');
          appendFileSync(events, 'serial-second\\n');
        });`);
      const harness = `import { runTestGroups } from ${JSON.stringify(runnerUrl)};
        process.exitCode = await runTestGroups(${JSON.stringify(files)}, {
          cwd: ${JSON.stringify(root)}, serialFiles: ${JSON.stringify(files.slice(1))}
        });`;
      let result;
      try {
        // The fixture is a fresh test runner, not a nested node:test worker.
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        result = { ...await execute(process.execPath, ["--input-type=module", "-e", harness], { windowsHide: true, env }), code: 0 };
      } catch (error) {
        result = error;
      }
      assert.equal(result.code, firstFails || secondFails ? 1 : 0, result.stderr);
      assert.equal(await readFile(eventsPath, "utf8"), "parallel\nserial-first\nserial-second\n");
      assert.match(result.stdout, /\[tests\] Parallel: 1 files/);
      assert.match(result.stdout, /\[tests\] PowerPoint \(serial\): 2 files/);
      if (firstFails) assert.match(result.stdout, /PARALLEL_FAILURE/);
      if (secondFails) assert.match(result.stdout, /SERIAL_FAILURE/);
    });
  }
});

test("test runner continues after a child cannot start", async (t) => {
  const reported = t.mock.method(console, "error", () => {});
  let calls = 0;
  const code = await runTestGroups(["unit.test.mjs", "office.test.mjs"], {
    serialFiles: ["office.test.mjs"],
    log: () => {},
    runGroup: async () => {
      calls += 1;
      if (calls === 1) throw new Error("SYNTHETIC_CHILD_START_FAILURE");
      return 0;
    },
  });
  assert.equal(calls, 2);
  assert.equal(code, 1);
  assert.equal(reported.mock.calls[0].arguments[0].message, "SYNTHETIC_CHILD_START_FAILURE");
});

test("test runner does not invoke automatic discovery for an empty group", async () => {
  for (const serialFiles of [[], ["only.test.mjs"]]) {
    const calls = [];
    assert.equal(await runTestGroups(["only.test.mjs"], {
      serialFiles, log: () => {}, runGroup: async (args) => { calls.push(args); return 0; },
    }), 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].at(-1), "only.test.mjs");
  }
  await assert.rejects(runTestGroups([], { log: () => {} }), /No test files found/);
});

test("test runner reports each group's external lock skips and requires PowerPoint only when requested", async () => {
  for (const requirePowerPoint of [false, true]) {
    const messages = [];
    let reportPath;
    const code = await runTestGroups(["unit.test.mjs", "office.test.mjs"], {
      serialFiles: ["office.test.mjs"], requirePowerPoint,
      log: (message) => messages.push(message),
      runGroup: async (args, { env }) => {
        reportPath = env.WOOLIM_TEST_LOCK_REPORT;
        const file = args.at(-1);
        const entries = file === "unit.test.mjs"
          ? [{ file, test: "parallel lock skip", waitedMs: 180_001 }]
          : [{ file, test: "first office skip", waitedMs: 180_002 }, { file, test: "second office skip", waitedMs: 180_003 }];
        for (const entry of entries) await appendFile(reportPath, `${JSON.stringify(entry)}\n`);
        return 0;
      },
    });
    assert.equal(code, requirePowerPoint ? 1 : 0);
    assert.equal(messages.filter((message) => message.includes("외부 점유로")).length, 2);
    assert.ok(messages.some((message) => message.includes("Parallel: 자물쇠 외부 점유로 1건 건너뜀")));
    assert.ok(messages.some((message) => message.includes("PowerPoint (serial): 자물쇠 외부 점유로 2건 건너뜀")));
    for (const name of ["parallel lock skip", "first office skip", "second office skip"]) {
      assert.equal(messages.filter((message) => message.includes(name)).length, 1);
    }
    await assert.rejects(stat(path.dirname(reportPath)), { code: "ENOENT" });
  }
});

test("test runner reports skips and removes the report even when a child throws", async (t) => {
  t.mock.method(console, "error", () => {});
  const messages = [];
  let reportPath;
  const code = await runTestGroups(["office.test.mjs"], {
    serialFiles: ["office.test.mjs"],
    log: (message) => messages.push(message),
    runGroup: async (_args, { env }) => {
      reportPath = env.WOOLIM_TEST_LOCK_REPORT;
      await appendFile(reportPath, `${JSON.stringify({ file: "office.test.mjs", test: "skip before failure", waitedMs: 1000 })}\n`);
      throw new Error("SYNTHETIC_CHILD_FAILURE_AFTER_SKIP");
    },
  });
  assert.equal(code, 1);
  assert.ok(messages.some((message) => message.includes("skip before failure")));
  await assert.rejects(stat(path.dirname(reportPath)), { code: "ENOENT" });
});

test("test runner removes its temporary directory if a report cannot be read", async () => {
  let reportPath;
  await assert.rejects(runTestGroups(["office.test.mjs"], {
    serialFiles: ["office.test.mjs"], log: () => {},
    runGroup: async (_args, { env }) => {
      reportPath = env.WOOLIM_TEST_LOCK_REPORT;
      await appendFile(reportPath, "not-json\n");
      return 0;
    },
  }), SyntaxError);
  await assert.rejects(stat(path.dirname(reportPath)), { code: "ENOENT" });
});

test("test runner command line defaults to optional PowerPoint and accepts the required flag", () => {
  assert.deepEqual(parseTestRunnerArguments([]), { requirePowerPoint: false });
  assert.deepEqual(parseTestRunnerArguments(["--require-powerpoint"]), { requirePowerPoint: true });
  assert.throws(() => parseTestRunnerArguments(["--unknown"]), /Unknown test runner argument: --unknown/);
});

test("test runner reads external lock reports written by real child processes", async (t) => {
  const root = await fixture(t);
  const file = "office skip.test.mjs";
  await writeFile(path.join(root, file), `
    import { appendFileSync } from 'node:fs';
    import test from 'node:test';
    test('real child external lock skip', t => {
      t.skip('external holder fixture');
      appendFileSync(process.env.WOOLIM_TEST_LOCK_REPORT,
        JSON.stringify({ file: ${JSON.stringify(file)}, test: t.name, waitedMs: 1000 }) + '\\n');
    });
  `);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const requirePowerPoint of [false, true]) {
    const harness = `import { runTestGroups } from ${JSON.stringify(runnerUrl)};
      process.exitCode = await runTestGroups([${JSON.stringify(file)}], {
        cwd: ${JSON.stringify(root)}, serialFiles: [${JSON.stringify(file)}], requirePowerPoint: ${requirePowerPoint}
      });`;
    let result;
    try {
      result = { ...await execute(process.execPath, ["--input-type=module", "-e", harness], { windowsHide: true, env }), code: 0 };
    } catch (error) {
      result = error;
    }
    assert.equal(result.code, requirePowerPoint ? 1 : 0, result.stderr);
    assert.match(result.stdout, /PowerPoint \(serial\): 자물쇠 외부 점유로 1건 건너뜀/);
    assert.match(result.stdout, /office skip\.test\.mjs: real child external lock skip \(1000ms\)/);
  }
});

test("test runner permits required PowerPoint when no lock skips are reported", async () => {
  assert.equal(await runTestGroups(["office.test.mjs"], {
    serialFiles: ["office.test.mjs"], requirePowerPoint: true,
    log: () => {}, runGroup: async () => 0,
  }), 0);
});
