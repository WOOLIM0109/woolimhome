import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runTestGroups } from "../scripts/run-tests.mjs";

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
  assert.deepEqual(calls, [
    { args: ["--test", files[0], files[2]], options: { cwd: "fixture root" } },
    { args: ["--test", "--test-concurrency=1", files[1], files[3]], options: { cwd: "fixture root" } },
  ]);
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
