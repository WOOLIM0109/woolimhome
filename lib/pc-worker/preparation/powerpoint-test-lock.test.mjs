import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EXTERNAL_LOCK_SKIP_REASON, runWhenPowerPointFree } from './powerpoint-test-lock.mjs';

const busy = () => Object.assign(new Error('Another local slide preparation is already using PowerPoint.'), { code: 'POWERPOINT_BUSY' });

function harness(environment = {}) {
  let time = 0;
  const delays = [];
  const skips = [];
  const context = { name: 'sample lock test', skip: reason => skips.push(reason) };
  const options = {
    environment,
    file: 'lib/sample.test.mjs',
    now: () => time,
    sleep: async delay => { delays.push(delay); time += delay; },
    probe: async () => { throw new Error('unexpected probe'); },
  };
  return { context, options, delays, skips, advance: delay => { time += delay; } };
}

test('a first success runs immediately without sleeping or probing and returns the same value', async () => {
  const { context, options, delays, skips } = harness();
  const value = {};
  assert.equal(await runWhenPowerPointFree(context, async () => value, options), value);
  assert.deepEqual(delays, []);
  assert.deepEqual(skips, []);
});

test('only the exact converter lock error is retried; all other errors retain identity', async () => {
  for (const error of [
    Object.assign(new Error('PowerPoint is already running. Close it before preparing slides.'), { code: 'POWERPOINT_BUSY' }),
    Object.assign(new Error('Another local slide preparation is already using PowerPoint. '), { code: 'POWERPOINT_BUSY' }),
    Object.assign(new Error('Another local slide preparation is already using PowerPoint.'), { code: 'OTHER' }),
    new Error('POWERPOINT_BUSY'),
  ]) {
    const { context, options, delays } = harness();
    await assert.rejects(runWhenPowerPointFree(context, async () => { throw error; }, options), actual => actual === error);
    assert.deepEqual(delays, []);
  }
});

test('retry backoff reaches eight seconds then stays there without probing between attempts', async () => {
  const { context, options, delays, skips } = harness();
  let attempts = 0;
  assert.equal(await runWhenPowerPointFree(context, async () => {
    if (++attempts < 7) throw busy();
    return 'complete';
  }, options), 'complete');
  assert.equal(attempts, 7);
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
  assert.deepEqual(skips, []);
});

test('a new non-lock failure after contention is immediately thrown unchanged', async () => {
  const { context, options, delays, skips } = harness();
  const original = new Error('a real regression');
  let attempts = 0;
  await assert.rejects(runWhenPowerPointFree(context, async () => {
    throw ++attempts === 1 ? busy() : original;
  }, options), error => error === original);
  assert.deepEqual(delays, [1_000]);
  assert.deepEqual(skips, []);
});

test('deadline clips the final sleep and probes once; a free lock rethrows the last error unchanged', async () => {
  const { context, options, delays, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '10000' });
  let probes = 0;
  let lastError;
  options.probe = async () => { probes++; assert.deepEqual(delays, [1_000, 2_000, 4_000, 3_000]); return true; };
  await assert.rejects(runWhenPowerPointFree(context, async () => { lastError = busy(); throw lastError; }, options), error => error === lastError);
  assert.equal(probes, 1);
  assert.deepEqual(skips, []);
});

test('a slow first operation can reach the deadline without any preflight probe or retry', async () => {
  const { context, options, advance, delays, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '1000' });
  const original = busy();
  let probes = 0;
  options.probe = async () => { probes++; return true; };
  await assert.rejects(runWhenPowerPointFree(context, async () => { advance(1_001); throw original; }, options), error => error === original);
  assert.equal(probes, 1);
  assert.deepEqual(delays, []);
  assert.deepEqual(skips, []);
});

test('wait environment accepts only integers in range and otherwise uses 180 seconds', async () => {
  for (const [value, expected] of [
    [undefined, 180_000], ['999', 180_000], ['600001', 180_000], ['1000.0', 180_000],
    ['1e3', 180_000], [' 1000', 180_000], ['invalid', 180_000],
    ['1000', 1_000], ['600000', 600_000],
  ]) {
    const { context, options, delays, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: value });
    options.probe = async () => false;
    assert.equal(await runWhenPowerPointFree(context, async () => { throw busy(); }, options), undefined);
    assert.equal(delays.reduce((sum, value) => sum + value, 0), expected, String(value));
    assert.deepEqual(skips, [EXTERNAL_LOCK_SKIP_REASON]);
  }
});

test('occupied locks append one JSON line per skipped invocation without overwriting earlier records', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ppt-lock-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('ppt-lock-test-'));
    return rm(root, { recursive: true, force: true });
  });
  const report = path.join(root, 'skips.jsonl');
  for (let i = 0; i < 2; i++) {
    const { context, options, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '1000', WOOLIM_TEST_LOCK_REPORT: report });
    context.name += ` ${i}`;
    options.probe = async () => false;
    await runWhenPowerPointFree(context, async () => { throw busy(); }, options);
    assert.deepEqual(skips, [EXTERNAL_LOCK_SKIP_REASON]);
  }
  assert.deepEqual((await readFile(report, 'utf8')).trim().split('\n').map(line => JSON.parse(line)), [
    { file: 'lib/sample.test.mjs', test: 'sample lock test 0', waitedMs: 1_000 },
    { file: 'lib/sample.test.mjs', test: 'sample lock test 1', waitedMs: 1_000 },
  ]);
});

test('a failed final probe skips once rather than assuming the lock is free', async () => {
  const { context, options, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '1000' });
  let probes = 0;
  options.probe = async () => { probes++; throw new Error('access denied'); };
  await runWhenPowerPointFree(context, async () => { throw busy(); }, options);
  assert.equal(probes, 1);
  assert.deepEqual(skips, [EXTERNAL_LOCK_SKIP_REASON]);
});

test('the default PowerShell probe uses a short hidden process and releases an abandoned mutex', async () => {
  const { context, options, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '1000' });
  delete options.probe;
  let probes = 0;
  options.executePowerShell = async (executable, args, settings) => {
    probes++;
    assert.equal(executable, 'powershell.exe');
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.match(args[3], /catch \[System\.Threading\.AbandonedMutexException\] \{\s*\$free = \$true\s*\$m\.ReleaseMutex\(\)/);
    assert.match(args[3], /finally \{ \$m\.Dispose\(\) \}/);
    assert.equal(settings.windowsHide, true);
    assert.equal(settings.timeout, 10_000);
    return { stdout: '{"free":true}\r\n' };
  };
  const error = busy();
  await assert.rejects(runWhenPowerPointFree(context, async () => { throw error; }, options), actual => actual === error);
  assert.equal(probes, 1);
  assert.deepEqual(skips, []);
});

test('malformed or non-boolean PowerShell probe output never establishes a free lock', async () => {
  for (const stdout of ['bad JSON', '{"free":"true"}', '{}']) {
    const { context, options, skips } = harness({ WOOLIM_TEST_LOCK_WAIT_MS: '1000' });
    delete options.probe;
    options.executePowerShell = async () => ({ stdout });
    await runWhenPowerPointFree(context, async () => { throw busy(); }, options);
    assert.deepEqual(skips, [EXTERNAL_LOCK_SKIP_REASON]);
  }
});

test('only the opted-in synthetic generator recognizes the exact PowerShell thrown string', async () => {
  const error = Object.assign(new Error('Command failed: script containing POWERPOINT_BUSY'), {
    code: 1,
    stderr: 'POWERPOINT_BUSY\r\nAt line:1 char:1\r\n    + CategoryInfo : OperationStopped: (POWERPOINT_BUSY:String) [], RuntimeException\r\n    + FullyQualifiedErrorId : POWERPOINT_BUSY\r\n',
  });
  for (const enabled of [false, true]) {
    const { context, options, delays } = harness();
    options.syntheticPowerShell = enabled;
    let attempts = 0;
    const pending = runWhenPowerPointFree(context, async () => {
      if (++attempts === 1) throw error;
      return 'generated';
    }, options);
    if (enabled) {
      assert.equal(await pending, 'generated');
      assert.deepEqual(delays, [1_000]);
    } else {
      await assert.rejects(pending, actual => actual === error);
      assert.deepEqual(delays, []);
    }
  }
});

test('synthetic mode does not confuse command text or another PowerShell exception with contention', async () => {
  for (const stderr of [
    "ACTUAL_FAILURE\r\n+ if (!$m.WaitOne(0)) { throw 'POWERPOINT_BUSY' }\r\n    + FullyQualifiedErrorId : ACTUAL_FAILURE\r\n",
    'POWERPOINT_BUSY extra text\r\n    + FullyQualifiedErrorId : POWERPOINT_BUSY\r\n',
    'POWERPOINT_BUSY\r\n    + FullyQualifiedErrorId : ACTUAL_FAILURE\r\n',
  ]) {
    const error = Object.assign(new Error('Command includes POWERPOINT_BUSY'), { stderr });
    const { context, options, delays } = harness();
    options.syntheticPowerShell = true;
    await assert.rejects(runWhenPowerPointFree(context, async () => { throw error; }, options), actual => actual === error);
    assert.deepEqual(delays, []);
  }
});
