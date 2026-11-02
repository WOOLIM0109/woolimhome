import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { openPreparationWorkStore, type SourceFingerprint } from "./work-store.ts";
import type { RedactionState } from "./redaction-types.ts";

const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
function fail(code: string): never { throw new Error(code); }
export type RedactionCarryKey = {
  root: string; workRoot: string; sourceFingerprint: SourceFingerprint; sourceHash: string;
};
export type RedactionCarryEntry = {
  version: 1; sourceFingerprint: SourceFingerprint; sourceHash: string; savedAt: string; state: RedactionState;
};

export function defaultRedactionCarryStoreRoot() {
  return path.join(process.env.LOCALAPPDATA || path.join(homedir(), ".local", "share"), "WoolimWorker", "redaction-carry");
}
function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function safeRoot(input: RedactionCarryKey) {
  if (typeof input.root !== "string" || !path.isAbsolute(input.root) || input.root.includes("\0")
    || input.root.replaceAll("\\", "/").split("/").some((part) => part === ".." || part === ".")) fail("REDACTION_CARRY_UNSAFE_PATH");
  const absolute = path.resolve(input.root), workRoot = await realpath(input.workRoot);
  if (path.basename(absolute) !== "redaction-carry" || path.basename(path.dirname(absolute)) !== "WoolimWorker"
    || inside(workRoot, absolute) || inside(absolute, workRoot)) fail("REDACTION_CARRY_UNSAFE_PATH");
  let cursor = path.parse(absolute).root;
  for (const part of path.relative(cursor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await mkdir(cursor, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("REDACTION_CARRY_UNSAFE_PATH");
  }
  const canonical = await realpath(absolute);
  if (inside(workRoot, canonical) || inside(canonical, workRoot)) fail("REDACTION_CARRY_UNSAFE_PATH");
  return canonical;
}
function keyFile(input: RedactionCarryKey) {
  if (!input.sourceFingerprint || !SHA.test(input.sourceFingerprint.sha256)
    || !Number.isSafeInteger(input.sourceFingerprint.bytes) || input.sourceFingerprint.bytes < 0
    || !SHA.test(input.sourceHash)) fail("INVALID_REDACTION_CARRY_KEY");
  const fingerprint = createHash("sha256").update(JSON.stringify([input.sourceFingerprint.sha256, input.sourceFingerprint.bytes])).digest("hex");
  return `${fingerprint}-${input.sourceHash}.json`;
}
async function readEntry(root: string, file: string, input: RedactionCarryKey): Promise<RedactionCarryEntry | null> {
  const destination = path.join(root, file);
  let info;
  try { info = await lstat(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) fail("REDACTION_CARRY_UNSAFE_PATH");
  if (info.size > MAX_BYTES) fail("REDACTION_CARRY_CORRUPT");
  const bytes = await readFile(destination);
  if (bytes.length > MAX_BYTES) fail("REDACTION_CARRY_CORRUPT");
  let entry: RedactionCarryEntry;
  try { entry = JSON.parse(bytes.toString("utf8")); } catch { fail("REDACTION_CARRY_CORRUPT"); }
  if (!entry || typeof entry !== "object" || entry.version !== 1 || entry.sourceFingerprint?.sha256 !== input.sourceFingerprint.sha256
    || entry.sourceFingerprint.bytes !== input.sourceFingerprint.bytes || entry.sourceHash !== input.sourceHash
    || !Number.isFinite(Date.parse(entry.savedAt)) || !entry.state
    || entry.state.sourceHash !== input.sourceFingerprint.sha256 || entry.state.imageHash !== input.sourceHash) fail("REDACTION_CARRY_CORRUPT");
  return entry;
}
export async function readRedactionCarry(input: RedactionCarryKey) {
  const file = keyFile(input), root = await safeRoot(input);
  return readEntry(root, file, input);
}
/** The shared work-store lock also serializes writers from separate worker processes. */
export async function writeRedactionCarry(input: RedactionCarryKey & { state: RedactionState }) {
  const file = keyFile(input), root = await safeRoot(input);
  const state = input.state;
  const savedAt = [state.savedAt, state.output?.approvedAt].filter((date): date is string => !!date).sort().at(-1);
  if (!savedAt || !Number.isFinite(Date.parse(savedAt)) || state.sourceHash !== input.sourceFingerprint.sha256
    || state.imageHash !== input.sourceHash) fail("REDACTION_CARRY_CORRUPT");
  const deadline = Date.now() + 5_000;
  let lock;
  for (;;) {
    try { lock = await openPreparationWorkStore({ root }); break; }
    catch (error) {
      if ((error as { code?: string }).code !== "WORK_LOCKED" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const temporary = path.join(root, `.${randomUUID()}.tmp`);
  try {
    const previous = await readEntry(root, file, input);
    if (previous && Date.parse(previous.savedAt) > Date.parse(savedAt)) return;
    const entry: RedactionCarryEntry = { version: 1, sourceFingerprint: input.sourceFingerprint, sourceHash: input.sourceHash, savedAt, state };
    const payload = JSON.stringify(entry);
    if (Buffer.byteLength(payload) > MAX_BYTES) fail("REDACTION_CARRY_CORRUPT");
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(payload, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(root, file));
  } finally {
    await unlink(temporary).catch(() => undefined);
    await lock.release();
  }
}
