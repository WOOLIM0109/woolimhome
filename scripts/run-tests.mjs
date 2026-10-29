#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, SERIAL_POWERPOINT_TEST_FILES } from "./test-plan.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function runNodeTests(args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export async function runTestGroups(testFiles, {
  cwd = repositoryRoot,
  serialFiles = SERIAL_POWERPOINT_TEST_FILES,
  runGroup = runNodeTests,
  log = console.log,
  requirePowerPoint = false,
} = {}) {
  if (testFiles.length === 0) throw new Error("No test files found under lib.");
  const serial = new Set(serialFiles);
  const groups = [
    { name: "Parallel", flags: [], files: testFiles.filter((file) => !serial.has(file)) },
    { name: "PowerPoint (serial)", flags: ["--test-concurrency=1"], files: testFiles.filter((file) => serial.has(file)) },
  ];
  let exitCode = 0;
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "woolim-test-lock-"));
  const reportPath = path.join(reportDirectory, "skipped.jsonl");
  const env = { ...process.env, WOOLIM_TEST_LOCK_REPORT: reportPath };
  try {
    for (const group of groups) {
      log(`\n[tests] ${group.name}: ${group.files.length} files`);
      // With no explicit files, node --test would discover and rerun the whole suite.
      if (group.files.length === 0) continue;
      await writeFile(reportPath, "");
      try {
        const code = await runGroup(["--test", ...group.flags, ...group.files], { cwd, env });
        if (code !== 0) exitCode = 1;
      } catch (error) {
        console.error(error);
        exitCode = 1;
      }
      const skipped = (await readFile(reportPath, "utf8")).split(/\r?\n/)
        .filter((line) => line.trim()).map((line) => JSON.parse(line));
      if (skipped.length > 0) {
        log(`[tests] ${group.name}: 자물쇠 외부 점유로 ${skipped.length}건 건너뜀 — 작업자를 멈추고 다시 돌려야 확인된다`);
        for (const entry of skipped) log(`[tests]   ${entry.file}: ${entry.test} (${entry.waitedMs}ms)`);
        if (requirePowerPoint) exitCode = 1;
      }
    }
    return exitCode;
  } finally {
    const target = path.resolve(reportDirectory);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith("woolim-test-lock-")) {
      throw new Error("Unexpected test lock report directory.");
    }
    await rm(target, { recursive: true, force: true });
  }
}

export function parseTestRunnerArguments(args) {
  for (const argument of args) {
    if (argument !== "--require-powerpoint") throw new Error(`Unknown test runner argument: ${argument}`);
  }
  return { requirePowerPoint: args.includes("--require-powerpoint") };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseTestRunnerArguments(process.argv.slice(2));
    process.exitCode = await runTestGroups(await discoverTestFiles(repositoryRoot), options);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
