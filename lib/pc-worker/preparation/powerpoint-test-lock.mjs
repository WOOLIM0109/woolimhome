import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

export const EXTERNAL_LOCK_SKIP_REASON =
  'An external holder keeps the local PowerPoint preparation lock (the office worker task).';

const execute = promisify(execFile);
const LOCK_BUSY_MESSAGE = 'Another local slide preparation is already using PowerPoint.';
const DEFAULT_WAIT_MS = 180_000;
const probeCommand = `
$ErrorActionPreference = 'Stop'
$m = New-Object System.Threading.Mutex($false, "Local\\WoolimPowerPointPreparation")
try {
  $free = $m.WaitOne(0)
  if ($free) { $m.ReleaseMutex() }
} catch [System.Threading.AbandonedMutexException] {
  $free = $true
  $m.ReleaseMutex()
} finally { $m.Dispose() }
@{ free = $free } | ConvertTo-Json -Compress
`;

export function getPowerPointTestLockWaitMs(environment = process.env) {
  const value = environment.WOOLIM_TEST_LOCK_WAIT_MS;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return DEFAULT_WAIT_MS;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 1_000 && milliseconds <= 600_000
    ? milliseconds : DEFAULT_WAIT_MS;
}

function isLockContention(error, syntheticPowerShell) {
  if (error?.code === 'POWERPOINT_BUSY' && error.message === LOCK_BUSY_MESSAGE) return true;
  // execFile's message includes the command itself, so inspect only the thrown exception in stderr.
  return syntheticPowerShell && typeof error?.stderr === 'string'
    && /^POWERPOINT_BUSY\r?$/m.test(error.stderr)
    && /^\s*\+?\s*FullyQualifiedErrorId\s*:\s*POWERPOINT_BUSY\s*\r?$/m.test(error.stderr);
}

async function probePowerPointLock(executePowerShell) {
  const { stdout } = await executePowerShell('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', probeCommand,
  ], { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 });
  return JSON.parse(stdout.trim()).free === true;
}

/** Retry only converter lock contention; the converter owns its own mutex. */
export async function runWhenPowerPointFree(t, operation, options = {}) {
  const {
    environment = process.env,
    now = Date.now,
    sleep = setTimeout,
    probe = () => probePowerPointLock(options.executePowerShell ?? execute),
    syntheticPowerShell = false,
    file = t.filePath ?? '',
  } = options;
  const started = now();
  const deadline = started + getPowerPointTestLockWaitMs(environment);
  let delay = 1_000;
  let lastError;
  while (true) {
    try { return await operation(); }
    catch (error) {
      if (!isLockContention(error, syntheticPowerShell)) throw error;
      lastError = error;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, 8_000);
    if (now() >= deadline) break;
  }

  // This is the only probe: never compete with the converter before the deadline.
  let free = false;
  try { free = await probe() === true; }
  catch { /* An unavailable probe cannot establish that the lock is free. */ }
  if (free) throw lastError;

  t.skip(EXTERNAL_LOCK_SKIP_REASON);
  if (environment.WOOLIM_TEST_LOCK_REPORT) {
    await appendFile(environment.WOOLIM_TEST_LOCK_REPORT, `${JSON.stringify({
      file, test: t.name, waitedMs: Math.max(0, now() - started),
    })}\n`, 'utf8');
  }
  return undefined;
}
