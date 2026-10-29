#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, SERIAL_POWERPOINT_TEST_FILES } from "./test-plan.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function runNodeTests(args, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
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
} = {}) {
  if (testFiles.length === 0) throw new Error("No test files found under lib.");
  const serial = new Set(serialFiles);
  const groups = [
    { name: "Parallel", flags: [], files: testFiles.filter((file) => !serial.has(file)) },
    { name: "PowerPoint (serial)", flags: ["--test-concurrency=1"], files: testFiles.filter((file) => serial.has(file)) },
  ];
  let exitCode = 0;
  for (const group of groups) {
    log(`\n[tests] ${group.name}: ${group.files.length} files`);
    // With no explicit files, node --test would discover and rerun the whole suite.
    if (group.files.length === 0) continue;
    try {
      const code = await runGroup(["--test", ...group.flags, ...group.files], { cwd });
      if (code !== 0) exitCode = 1;
    } catch (error) {
      console.error(error);
      exitCode = 1;
    }
  }
  return exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await runTestGroups(await discoverTestFiles(repositoryRoot));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
