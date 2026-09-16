import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertPrivateWorkRoot } from "./private-work-root.ts";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "woolim-private-root-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  const sourcePath = path.join(sourceDirectory, "deck.pptx");
  await mkdir(sourceDirectory);
  await writeFile(sourcePath, "synthetic pptx placeholder");
  return { root, sourceDirectory, sourcePath };
}

async function directoryLink(target, linkPath) {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("allows a not-yet-created sibling work root and returns canonical paths", async (t) => {
  const fixturePaths = await fixture(t);
  const workRoot = path.join(fixturePaths.root, "private-work", "task-a");

  const result = await assertPrivateWorkRoot(fixturePaths.sourcePath, workRoot);

  assert.equal(result.sourcePath, await realpath(fixturePaths.sourcePath));
  assert.equal(result.workRoot, path.resolve(workRoot));
});

test("rejects a work root anywhere below the source directory", async (t) => {
  const fixturePaths = await fixture(t);
  await assert.rejects(
    assertPrivateWorkRoot(
      fixturePaths.sourcePath,
      path.join(fixturePaths.sourceDirectory, "nested", "private-work"),
    ),
    /DEDICATED_WORK_ROOT_REQUIRED/,
  );
});

test("rejects a work root that contains the source file", async (t) => {
  const fixturePaths = await fixture(t);
  await assert.rejects(
    assertPrivateWorkRoot(fixturePaths.sourcePath, fixturePaths.root),
    /DEDICATED_WORK_ROOT_REQUIRED/,
  );
});

test("rejects a nested link or junction in the work-root path", async (t) => {
  const fixturePaths = await fixture(t);
  const actualDirectory = path.join(fixturePaths.root, "actual-work-parent");
  const linkedDirectory = path.join(fixturePaths.root, "linked-work-parent");
  await mkdir(actualDirectory);
  await directoryLink(actualDirectory, linkedDirectory);

  await assert.rejects(
    assertPrivateWorkRoot(fixturePaths.sourcePath, path.join(linkedDirectory, "task-a")),
    /PRIVATE_LOCAL_WORK_ROOT_REQUIRED/,
  );
});

test("a lexical alias cannot hide a canonical sync-directory work root", async (t) => {
  const fixturePaths = await fixture(t);
  const syncDirectory = path.join(fixturePaths.root, "OneDrive - Company");
  const aliasDirectory = path.join(fixturePaths.root, "innocent-alias");
  await mkdir(syncDirectory);
  await directoryLink(syncDirectory, aliasDirectory);

  await assert.rejects(
    assertPrivateWorkRoot(fixturePaths.sourcePath, path.join(aliasDirectory, "task-a")),
    /PRIVATE_LOCAL_WORK_ROOT_REQUIRED/,
  );
});

test("allows a linked source path but returns the real read-only source target", async (t) => {
  const fixturePaths = await fixture(t);
  const sourceAlias = path.join(fixturePaths.root, "source-alias");
  await directoryLink(fixturePaths.sourceDirectory, sourceAlias);

  const result = await assertPrivateWorkRoot(
    path.join(sourceAlias, "deck.pptx"),
    path.join(fixturePaths.root, "private-work"),
  );

  assert.equal(result.sourcePath, await realpath(fixturePaths.sourcePath));
});
