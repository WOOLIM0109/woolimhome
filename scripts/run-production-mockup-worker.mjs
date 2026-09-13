import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPreparationRuntime, preparationChildEnvironment } from "./preparation-runtime-package.mjs";

const execute = promisify(execFile);

/** Values are captured in memory from a child pipe; never command-line arguments, logs or files. */
export async function readProductionWorkerSettings(environment = process.env) {
  if (process.platform !== "win32") throw new Error("MOCKUP_BRIDGE_WINDOWS_REQUIRED");
  const keys = ["WOOLIM_WORKER_SERVER_URL", "WOOLIM_WORKER_ID", "WOOLIM_WORKER_NAME", "WOOLIM_PC_WORKER_SECRET"];
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$result=@{};foreach($key in @(${keys.map((key) => `'${key}'`).join(",")})){$result[$key]=[Environment]::GetEnvironmentVariable($key,'User')};$result|ConvertTo-Json -Compress`;
  let persisted;
  try {
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: preparationChildEnvironment(environment), windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024,
    });
    persisted = JSON.parse(stdout.trim());
  } catch { throw new Error("MOCKUP_BRIDGE_SETTINGS_READ_FAILED"); }
  const value = (key, fallback = "") => String(environment[key] || persisted[key] || fallback).trim();
  return { serverUrl: value(keys[0], "https://woolim-site.vercel.app").replace(/\/$/, ""),
    workerId: value(keys[1], "becky-office-pc"), workerName: value(keys[2], "울림 집 PC (기존)"), secret: value(keys[3]) };
}

async function daemonLock(directory) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "mockup-bridge.lock");
  let handle;
  try { handle = await open(target, "wx", 0o600); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256) throw new Error("MOCKUP_BRIDGE_LOCK_INVALID");
    const record = JSON.parse(await readFile(target, "utf8"));
    if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error("MOCKUP_BRIDGE_LOCK_INVALID");
    try { process.kill(record.pid, 0); throw new Error("MOCKUP_BRIDGE_ALREADY_RUNNING"); }
    catch (probe) { if (probe?.code !== "ESRCH") throw probe; }
    await unlink(target);
    handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid }));
  await handle.close();
  return async () => {
    // A replaced/invalid lock is not ours to remove.
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return;
    const current = JSON.parse(await readFile(target, "utf8"));
    if (current.pid === process.pid) await unlink(target);
  };
}

export async function runProductionMockupWorker({ expectedFingerprint, checkOnly = false, once = false }) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const inspected = await inspectPreparationRuntime(root, { expectedFingerprint });
  const settings = await readProductionWorkerSettings();
  const { createProductionMockupBridge, createProductionBridgeTransport, validateBridgeSettings } = await import("../lib/pc-worker/preparation/production-bridge.ts");
  validateBridgeSettings(settings);
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) throw new Error("MOCKUP_BRIDGE_PRIVATE_ROOT_INVALID");
  if (checkOnly) return { ready: true, started: false, bridgeVersion: "mockup-bridge-1", workerVersion: "2.10.0", fingerprint: inspected.fingerprint };
  // The PowerPoint adapter has a fixed cwd-relative script contract.
  process.chdir(root);
  const cleanEnvironment = preparationChildEnvironment();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, cleanEnvironment);
  const privateRoot = path.join(localAppData, "WoolimWorker", "p");
  const bridge = await createProductionMockupBridge({ privateRoot, transport: createProductionBridgeTransport(settings),
    onEvent: ({ code, sessionId }) => console.log(`${code}${sessionId ? ` ${sessionId}` : ""}`) });
  const release = await daemonLock(privateRoot);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await bridge.resume();
    do {
      await bridge.tick();
      if (once || stopping) break;
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); process.off("SIGINT", finish); process.off("SIGTERM", finish); resolve(); };
        const timer = setTimeout(finish, 60_000);
        process.once("SIGINT", finish); process.once("SIGTERM", finish);
      });
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await bridge.close(); await release();
  }
  return { stopped: true };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] !== "--expected-fingerprint" || args.length < 2 || args.length > 3 || (args[2] && !["--check", "--once"].includes(args[2]))) {
    console.error("Usage: node --experimental-strip-types <runtime>/scripts/run-production-mockup-worker.mjs --expected-fingerprint <trusted SHA256> [--check|--once]");
    process.exitCode = 2;
  } else {
    runProductionMockupWorker({ expectedFingerprint: args[1], checkOnly: args[2] === "--check", once: args[2] === "--once" })
      .then((result) => console.log(JSON.stringify(result))).catch((error) => {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,120}$/.test(error.message) ? error.message : "MOCKUP_BRIDGE_START_FAILED";
        console.error(code); process.exitCode = 1;
      });
  }
}
