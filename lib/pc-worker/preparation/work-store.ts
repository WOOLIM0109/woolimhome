import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export const PREPARATION_WORK_SCHEMA_VERSION = 1 as const;

export const PREPARATION_STAGE_ORDER = [
  "source_inspection",
  "preview_generation",
  "slide_selection",
  "high_resolution_conversion",
] as const;

export type PreparationStage = (typeof PREPARATION_STAGE_ORDER)[number];
export type NonSelectionPreparationStage = Exclude<PreparationStage, "slide_selection">;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SourceFingerprint = Readonly<{
  sha256: string;
  bytes: number;
}>;

export type BuildFingerprint = Readonly<{
  source: SourceFingerprint;
  conversionSettingsFingerprint: string;
  fontFingerprint: string;
}>;

export type ActiveSetReference = Readonly<{
  setId: string;
  buildId: string | null;
}>;

export type PreparationArtifactRecord = Readonly<{
  key: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  recordedAt: string;
  data: JsonValue | null;
}>;

export type PreparationStageRecord = Readonly<{
  stage: PreparationStage;
  stageRevision: number;
  buildRevision: number;
  inputFingerprint: string;
  artifactKeys: readonly string[];
  completedAt: string;
  data: JsonValue | null;
}>;

export type PreparationBuildRecord = Readonly<{
  schemaVersion: typeof PREPARATION_WORK_SCHEMA_VERSION;
  workId: string;
  buildId: string;
  revision: number;
  fingerprint: BuildFingerprint;
  selectionRevision: number;
  selectionFingerprint: string | null;
  stages: Readonly<Partial<Record<PreparationStage, PreparationStageRecord>>>;
  artifacts: Readonly<Record<string, PreparationArtifactRecord>>;
  createdAt: string;
  updatedAt: string;
}>;

export type PreparationWorkRecord = Readonly<{
  schemaVersion: typeof PREPARATION_WORK_SCHEMA_VERSION;
  workId: string;
  revision: number;
  currentBuildId: string;
  buildIds: readonly string[];
  activeSetRef: ActiveSetReference | null;
  createdAt: string;
  updatedAt: string;
}>;

type MutableBuildRecord = {
  schemaVersion: typeof PREPARATION_WORK_SCHEMA_VERSION;
  workId: string;
  buildId: string;
  revision: number;
  fingerprint: {
    source: { sha256: string; bytes: number };
    conversionSettingsFingerprint: string;
    fontFingerprint: string;
  };
  selectionRevision: number;
  selectionFingerprint: string | null;
  stages: Partial<Record<PreparationStage, PreparationStageRecord>>;
  artifacts: Record<string, PreparationArtifactRecord>;
  createdAt: string;
  updatedAt: string;
};

type MutableWorkRecord = {
  schemaVersion: typeof PREPARATION_WORK_SCHEMA_VERSION;
  workId: string;
  revision: number;
  currentBuildId: string;
  buildIds: string[];
  activeSetRef: ActiveSetReference | null;
  createdAt: string;
  updatedAt: string;
};

type LockRecord = {
  schemaVersion: typeof PREPARATION_WORK_SCHEMA_VERSION;
  pid: number;
  instanceId: string;
  token: string;
  acquiredAt: string;
};

export type ProcessLivenessProbe = (pid: number) => boolean | Promise<boolean>;

export class PreparationWorkStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PreparationWorkStoreError";
    this.code = code;
  }
}

export class PreparationRevisionConflictError extends PreparationWorkStoreError {
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;

  constructor(entity: string, expectedRevision: number | null, actualRevision: number | null) {
    super(
      "REVISION_CONFLICT",
      `${entity} revision conflict: expected ${String(expectedRevision)}, actual ${String(actualRevision)}`,
    );
    this.name = "PreparationRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class PreparationWorkLockedError extends PreparationWorkStoreError {
  readonly ownerPid: number;

  constructor(ownerPid: number) {
    super("WORK_LOCKED", `Preparation work is already owned by live process ${ownerPid}.`);
    this.name = "PreparationWorkLockedError";
    this.ownerPid = ownerPid;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const ARTIFACT_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const INTERNAL_LOCK_FILE = ".preparation-work.lock";
const WORK_RECORD_FILE = "work.json";

function fail(code: string, message: string): never {
  throw new PreparationWorkStoreError(code, message);
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) fail("INVALID_ID", `${label} must be a UUID.`);
}

function assertSha256(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) fail("INVALID_FINGERPRINT", `${label} must be a SHA-256 hex digest.`);
}

function assertNonEmptyFingerprint(value: string, label: string) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    fail("INVALID_FINGERPRINT", `${label} must be a non-empty fingerprint.`);
  }
}

function assertRevision(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_REVISION", `${label} must be a non-negative safe integer.`);
  }
}

function cloneJson<T>(value: T): T {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INVALID_JSON", "Stored metadata must be JSON serializable.");
  }
  if (serialized === undefined) fail("INVALID_JSON", "Stored metadata must be JSON serializable.");
  return JSON.parse(serialized) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

function immutableCopy<T>(value: T): Readonly<T> {
  return deepFreeze(cloneJson(value));
}

function nowIso(now: () => Date) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail("INVALID_CLOCK", "The work-store clock returned an invalid date.");
  }
  return value.toISOString();
}

function normalizeFingerprint(input: BuildFingerprint): MutableBuildRecord["fingerprint"] {
  assertSha256(input.source.sha256, "source.sha256");
  if (!Number.isSafeInteger(input.source.bytes) || input.source.bytes < 0) {
    fail("INVALID_FINGERPRINT", "source.bytes must be a non-negative safe integer.");
  }
  assertNonEmptyFingerprint(input.conversionSettingsFingerprint, "conversionSettingsFingerprint");
  assertNonEmptyFingerprint(input.fontFingerprint, "fontFingerprint");
  return {
    source: { sha256: input.source.sha256.toLowerCase(), bytes: input.source.bytes },
    conversionSettingsFingerprint: input.conversionSettingsFingerprint,
    fontFingerprint: input.fontFingerprint,
  };
}

function sameBuildFingerprint(
  left: MutableBuildRecord["fingerprint"],
  right: MutableBuildRecord["fingerprint"],
) {
  return left.source.sha256 === right.source.sha256
    && left.source.bytes === right.source.bytes
    && left.conversionSettingsFingerprint === right.conversionSettingsFingerprint
    && left.fontFingerprint === right.fontFingerprint;
}

function normalizeArtifactRelativePath(value: string) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("UNSAFE_PATH", "Artifact path must be a non-empty relative path.");
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    fail("UNSAFE_PATH", "Absolute artifact paths are not allowed.");
  }
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("UNSAFE_PATH", "Artifact path traversal is not allowed.");
  }
  if (segments.some((segment) => /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment))) {
    fail("UNSAFE_PATH", "Artifact path contains an unsafe Windows path segment.");
  }
  return segments.join("/");
}

async function pathExists(value: string) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSymlinkComponents(root: string, relativePath: string, includeLeaf: boolean) {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail("UNSAFE_PATH", "Artifact root must remain a real directory.");
  }
  const segments = relativePath.split("/");
  const end = includeLeaf ? segments.length : Math.max(segments.length - 1, 0);
  let current = root;
  for (let index = 0; index < end; index += 1) {
    current = path.join(current, segments[index]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        fail("UNSAFE_PATH", `Symbolic-link path components are not allowed: ${relativePath}`);
      }
      if (index < end - 1 && !info.isDirectory()) {
        fail("UNSAFE_PATH", `Artifact parent is not a directory: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function ensureSafeDirectory(root: string, relativeDirectory: string) {
  if (!relativeDirectory) return;
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail("UNSAFE_PATH", "Work root must remain a real directory.");
  }
  const normalized = normalizeArtifactRelativePath(relativeDirectory);
  let current = root;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        fail("UNSAFE_PATH", `Unsafe directory in work root: ${normalized}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        fail("UNSAFE_PATH", `Unsafe directory in work root: ${normalized}`);
      }
    }
  }
}

async function atomicWriteJson(filePath: string, value: unknown) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readJsonFile(filePath: string, missingIsNull = false): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (missingIsNull && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      fail("CORRUPT_STATE", `Invalid JSON state file: ${path.basename(filePath)}`);
    }
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseWorkRecord(value: unknown): MutableWorkRecord {
  if (!isPlainObject(value)
    || value.schemaVersion !== PREPARATION_WORK_SCHEMA_VERSION
    || typeof value.workId !== "string"
    || typeof value.currentBuildId !== "string"
    || !Array.isArray(value.buildIds)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || typeof value.revision !== "number") {
    fail("CORRUPT_STATE", "Work record has an invalid shape.");
  }
  assertUuid(value.workId, "workId");
  assertUuid(value.currentBuildId, "currentBuildId");
  assertRevision(value.revision, "work revision");
  const buildIds = value.buildIds.map((entry) => {
    if (typeof entry !== "string") fail("CORRUPT_STATE", "Work buildIds must contain UUIDs.");
    assertUuid(entry, "buildId");
    return entry;
  });
  if (!buildIds.includes(value.currentBuildId)) {
    fail("CORRUPT_STATE", "Current build is missing from the work build list.");
  }
  let activeSetRef: ActiveSetReference | null = null;
  if (value.activeSetRef !== null) {
    if (!isPlainObject(value.activeSetRef)
      || typeof value.activeSetRef.setId !== "string"
      || value.activeSetRef.setId.trim().length === 0
      || (value.activeSetRef.buildId !== null && typeof value.activeSetRef.buildId !== "string")) {
      fail("CORRUPT_STATE", "Active-set reference has an invalid shape.");
    }
    activeSetRef = {
      setId: value.activeSetRef.setId,
      buildId: value.activeSetRef.buildId as string | null,
    };
  }
  return {
    schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
    workId: value.workId,
    revision: value.revision,
    currentBuildId: value.currentBuildId,
    buildIds,
    activeSetRef,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseArtifactRecord(key: string, value: unknown): PreparationArtifactRecord {
  if (!isPlainObject(value)
    || value.key !== key
    || typeof value.relativePath !== "string"
    || typeof value.sha256 !== "string"
    || typeof value.bytes !== "number"
    || typeof value.recordedAt !== "string"
    || !("data" in value)) {
    fail("CORRUPT_STATE", `Artifact ${key} has an invalid shape.`);
  }
  if (!ARTIFACT_KEY_PATTERN.test(key)) fail("CORRUPT_STATE", `Artifact key is unsafe: ${key}`);
  normalizeArtifactRelativePath(value.relativePath);
  assertSha256(value.sha256, `artifact ${key} sha256`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    fail("CORRUPT_STATE", `Artifact ${key} has an invalid byte length.`);
  }
  return {
    key,
    relativePath: value.relativePath,
    sha256: value.sha256.toLowerCase(),
    bytes: value.bytes,
    recordedAt: value.recordedAt,
    data: cloneJson(value.data as JsonValue),
  };
}

function parseStageRecord(stage: PreparationStage, value: unknown): PreparationStageRecord {
  if (!isPlainObject(value)
    || value.stage !== stage
    || typeof value.stageRevision !== "number"
    || typeof value.buildRevision !== "number"
    || typeof value.inputFingerprint !== "string"
    || !Array.isArray(value.artifactKeys)
    || typeof value.completedAt !== "string"
    || !("data" in value)) {
    fail("CORRUPT_STATE", `Stage ${stage} has an invalid shape.`);
  }
  assertRevision(value.stageRevision, `${stage} stage revision`);
  assertRevision(value.buildRevision, `${stage} build revision`);
  assertNonEmptyFingerprint(value.inputFingerprint, `${stage} inputFingerprint`);
  const artifactKeys = value.artifactKeys.map((entry) => {
    if (typeof entry !== "string" || !ARTIFACT_KEY_PATTERN.test(entry)) {
      fail("CORRUPT_STATE", `Stage ${stage} has an invalid artifact key.`);
    }
    return entry;
  });
  return {
    stage,
    stageRevision: value.stageRevision,
    buildRevision: value.buildRevision,
    inputFingerprint: value.inputFingerprint,
    artifactKeys,
    completedAt: value.completedAt,
    data: cloneJson(value.data as JsonValue),
  };
}

function parseBuildRecord(value: unknown): MutableBuildRecord {
  if (!isPlainObject(value)
    || value.schemaVersion !== PREPARATION_WORK_SCHEMA_VERSION
    || typeof value.workId !== "string"
    || typeof value.buildId !== "string"
    || typeof value.revision !== "number"
    || !isPlainObject(value.fingerprint)
    || !isPlainObject(value.fingerprint.source)
    || typeof value.fingerprint.source.sha256 !== "string"
    || typeof value.fingerprint.source.bytes !== "number"
    || typeof value.fingerprint.conversionSettingsFingerprint !== "string"
    || typeof value.fingerprint.fontFingerprint !== "string"
    || typeof value.selectionRevision !== "number"
    || (value.selectionFingerprint !== null && typeof value.selectionFingerprint !== "string")
    || !isPlainObject(value.stages)
    || !isPlainObject(value.artifacts)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string") {
    fail("CORRUPT_STATE", "Build record has an invalid shape.");
  }
  assertUuid(value.workId, "workId");
  assertUuid(value.buildId, "buildId");
  assertRevision(value.revision, "build revision");
  assertRevision(value.selectionRevision, "selection revision");
  const fingerprint = normalizeFingerprint({
    source: {
      sha256: value.fingerprint.source.sha256,
      bytes: value.fingerprint.source.bytes,
    },
    conversionSettingsFingerprint: value.fingerprint.conversionSettingsFingerprint,
    fontFingerprint: value.fingerprint.fontFingerprint,
  });
  if (value.selectionFingerprint !== null) {
    assertNonEmptyFingerprint(value.selectionFingerprint, "selectionFingerprint");
  }
  const artifacts: Record<string, PreparationArtifactRecord> = {};
  for (const [key, record] of Object.entries(value.artifacts)) {
    artifacts[key] = parseArtifactRecord(key, record);
  }
  const stages: MutableBuildRecord["stages"] = {};
  for (const [stage, record] of Object.entries(value.stages)) {
    if (!PREPARATION_STAGE_ORDER.includes(stage as PreparationStage)) {
      fail("CORRUPT_STATE", `Unknown preparation stage: ${stage}`);
    }
    stages[stage as PreparationStage] = parseStageRecord(stage as PreparationStage, record);
  }
  return {
    schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
    workId: value.workId,
    buildId: value.buildId,
    revision: value.revision,
    fingerprint,
    selectionRevision: value.selectionRevision,
    selectionFingerprint: value.selectionFingerprint,
    stages,
    artifacts,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function defaultProcessLivenessProbe(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return true;
  }
}

function parseLockRecord(value: unknown): LockRecord {
  if (!isPlainObject(value)
    || value.schemaVersion !== PREPARATION_WORK_SCHEMA_VERSION
    || typeof value.pid !== "number"
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.instanceId !== "string"
    || !UUID_PATTERN.test(value.instanceId)
    || typeof value.token !== "string"
    || !UUID_PATTERN.test(value.token)
    || typeof value.acquiredAt !== "string") {
    fail("CORRUPT_LOCK", "Preparation work lock is malformed and was not removed.");
  }
  return value as LockRecord;
}

async function createLockFile(lockPath: string, record: LockRecord) {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

async function hashRegularFile(filePath: string) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    fail("INVALID_ARTIFACT", "Artifact must be a regular file and not a symbolic link.");
  }
  if (before.nlink > 1) {
    fail("INVALID_ARTIFACT", "Hard-linked artifacts are not allowed.");
  }
  const digest = createHash("sha256");
  let bytes = 0;
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink > 1 || opened.ino !== before.ino) {
      fail("INVALID_ARTIFACT", "Artifact changed to an unsafe file before it could be read.");
    }
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      digest.update(buffer);
      bytes += buffer.byteLength;
    }
  } finally {
    await handle.close();
  }
  const after = await stat(filePath);
  if (!after.isFile()
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ino !== after.ino
    || bytes !== after.size) {
    fail("ARTIFACT_CHANGED", "Artifact changed while its fingerprint was being calculated.");
  }
  return { sha256: digest.digest("hex"), bytes };
}

export type OpenPreparationWorkStoreOptions = Readonly<{
  root: string;
  pid?: number;
  isProcessAlive?: ProcessLivenessProbe;
  now?: () => Date;
}>;

export type BeginOrResumeBuildInput = Readonly<{
  expectedWorkRevision: number | null;
  workId?: string;
  fingerprint: BuildFingerprint;
}>;

export type BeginOrResumeBuildResult = Readonly<{
  work: PreparationWorkRecord;
  build: PreparationBuildRecord;
  resumed: boolean;
}>;

export type CompleteStageInput = Readonly<{
  buildId: string;
  stage: NonSelectionPreparationStage;
  expectedRevision: number;
  inputFingerprint: string;
  artifactKeys?: readonly string[];
  data?: JsonValue;
}>;

export type RecordSelectionInput = Readonly<{
  buildId: string;
  expectedRevision: number;
  expectedSelectionRevision: number;
  selectionFingerprint: string;
  data?: JsonValue;
}>;

export type RecordArtifactInput = Readonly<{
  buildId: string;
  key: string;
  expectedRevision: number;
  relativePath: string;
  data?: JsonValue;
}>;

export type ReusableArtifact = Readonly<{
  record: PreparationArtifactRecord;
  absolutePath: string;
}>;

export class PreparationWorkStore {
  readonly root: string;
  readonly pid: number;

  readonly #now: () => Date;
  readonly #lockPath: string;
  readonly #lock: LockRecord;
  #released = false;

  private constructor(root: string, pid: number, now: () => Date, lock: LockRecord) {
    this.root = root;
    this.pid = pid;
    this.#now = now;
    this.#lockPath = path.join(root, INTERNAL_LOCK_FILE);
    this.#lock = lock;
  }

  static async open(options: OpenPreparationWorkStoreOptions) {
    if (!path.isAbsolute(options.root)) {
      fail("UNSAFE_ROOT", "Preparation work root must be an absolute path.");
    }
    const pid = options.pid ?? process.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) fail("INVALID_PID", "Lock PID must be positive.");
    const now = options.now ?? (() => new Date());
    const probe = options.isProcessAlive ?? defaultProcessLivenessProbe;

    await mkdir(options.root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(options.root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      fail("UNSAFE_ROOT", "Preparation work root must be a real directory, not a symbolic link.");
    }
    const canonicalRoot = await realpath(options.root);
    const lockPath = path.join(canonicalRoot, INTERNAL_LOCK_FILE);
    const ownLock: LockRecord = {
      schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
      pid,
      instanceId: randomUUID(),
      token: randomUUID(),
      acquiredAt: nowIso(now),
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await createLockFile(lockPath, ownLock)) {
        return new PreparationWorkStore(canonicalRoot, pid, now, ownLock);
      }

      let existingText: string;
      try {
        existingText = await readFile(lockPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      let existing: LockRecord;
      try {
        existing = parseLockRecord(JSON.parse(existingText) as unknown);
      } catch (error) {
        if (error instanceof SyntaxError) {
          fail("CORRUPT_LOCK", "Preparation work lock is malformed and was not removed.");
        }
        throw error;
      }
      if (await probe(existing.pid)) throw new PreparationWorkLockedError(existing.pid);

      // A dead PID is the only lock we reclaim. Re-read the token immediately
      // before unlinking so a concurrently replaced live lock is never removed.
      const confirmation = parseLockRecord(await readJsonFile(lockPath));
      if (confirmation.token !== existing.token || confirmation.instanceId !== existing.instanceId) continue;
      if (await probe(confirmation.pid)) throw new PreparationWorkLockedError(confirmation.pid);
      await unlink(lockPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
    fail("LOCK_RACE", "Could not acquire preparation work ownership after repeated lock changes.");
  }

  async release() {
    if (this.#released) return;
    const current = parseLockRecord(await readJsonFile(this.#lockPath));
    if (current.token !== this.#lock.token || current.instanceId !== this.#lock.instanceId) {
      this.#released = true;
      fail("LOCK_LOST", "Preparation work lock ownership changed; another lock was not removed.");
    }
    await unlink(this.#lockPath);
    this.#released = true;
  }

  async #assertOwned() {
    if (this.#released) fail("LOCK_RELEASED", "Preparation work store has already been released.");
    const current = parseLockRecord(await readJsonFile(this.#lockPath));
    if (current.token !== this.#lock.token || current.instanceId !== this.#lock.instanceId) {
      fail("LOCK_LOST", "Preparation work lock ownership changed.");
    }
  }

  #workPath() {
    return path.join(this.root, WORK_RECORD_FILE);
  }

  #buildDirectory(buildId: string) {
    assertUuid(buildId, "buildId");
    return path.join(this.root, "builds", buildId);
  }

  #buildRecordPath(buildId: string) {
    return path.join(this.#buildDirectory(buildId), "record.json");
  }

  #artifactRoot(buildId: string) {
    return path.join(this.#buildDirectory(buildId), "artifacts");
  }

  async readWork(): Promise<PreparationWorkRecord | null> {
    if (await pathExists(this.#workPath())) {
      await assertNoSymlinkComponents(this.root, WORK_RECORD_FILE, true);
    }
    const raw = await readJsonFile(this.#workPath(), true);
    return raw === null ? null : immutableCopy(parseWorkRecord(raw));
  }

  async readBuild(buildId: string): Promise<PreparationBuildRecord> {
    assertUuid(buildId, "buildId");
    const work = await this.readWork();
    if (!work || !work.buildIds.includes(buildId)) {
      fail("BUILD_NOT_FOUND", `Build ${buildId} is not registered in this work root.`);
    }
    await assertNoSymlinkComponents(this.root, `builds/${buildId}/record.json`, true);
    const raw = await readJsonFile(this.#buildRecordPath(buildId));
    const build = parseBuildRecord(raw);
    if (build.workId !== work.workId || build.buildId !== buildId) {
      fail("CORRUPT_STATE", "Build identity does not match its work record.");
    }
    return immutableCopy(build);
  }

  async #readMutableBuild(buildId: string) {
    assertUuid(buildId, "buildId");
    const work = await this.readWork();
    if (!work || !work.buildIds.includes(buildId)) {
      fail("BUILD_NOT_FOUND", `Build ${buildId} is not registered in this work root.`);
    }
    await assertNoSymlinkComponents(this.root, `builds/${buildId}/record.json`, true);
    const build = parseBuildRecord(await readJsonFile(this.#buildRecordPath(buildId)));
    if (build.workId !== work.workId || build.buildId !== buildId) {
      fail("CORRUPT_STATE", "Build identity does not match its work record.");
    }
    return build;
  }

  async #assertCurrentBuild(buildId: string) {
    const work = await this.readWork();
    if (!work || work.currentBuildId !== buildId) {
      fail("BUILD_NOT_CURRENT", "Completed builds are preserved and cannot be mutated as the current build.");
    }
  }

  async beginOrResumeBuild(input: BeginOrResumeBuildInput): Promise<BeginOrResumeBuildResult> {
    await this.#assertOwned();
    const fingerprint = normalizeFingerprint(input.fingerprint);
    if (input.expectedWorkRevision !== null) assertRevision(input.expectedWorkRevision, "expectedWorkRevision");
    if (input.workId !== undefined) assertUuid(input.workId, "workId");

    if (await pathExists(this.#workPath())) {
      await assertNoSymlinkComponents(this.root, WORK_RECORD_FILE, true);
    }
    const existingRaw = await readJsonFile(this.#workPath(), true);
    if (existingRaw === null) {
      if (input.expectedWorkRevision !== null) {
        throw new PreparationRevisionConflictError("work", input.expectedWorkRevision, null);
      }
      const timestamp = nowIso(this.#now);
      const workId = input.workId ?? randomUUID();
      const buildId = randomUUID();
      const build: MutableBuildRecord = {
        schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
        workId,
        buildId,
        revision: 0,
        fingerprint,
        selectionRevision: 0,
        selectionFingerprint: null,
        stages: {},
        artifacts: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const work: MutableWorkRecord = {
        schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
        workId,
        revision: 0,
        currentBuildId: buildId,
        buildIds: [buildId],
        activeSetRef: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await ensureSafeDirectory(this.root, `builds/${buildId}/artifacts`);
      await atomicWriteJson(this.#buildRecordPath(buildId), build);
      await atomicWriteJson(this.#workPath(), work);
      return immutableCopy({ work, build, resumed: false }) as BeginOrResumeBuildResult;
    }

    const work = parseWorkRecord(existingRaw);
    if (input.workId !== undefined && input.workId !== work.workId) {
      fail("WORK_ID_CONFLICT", "The supplied workId does not match this task-private root.");
    }
    if (input.expectedWorkRevision !== work.revision) {
      throw new PreparationRevisionConflictError("work", input.expectedWorkRevision, work.revision);
    }
    const currentBuild = await this.#readMutableBuild(work.currentBuildId);
    if (currentBuild.workId !== work.workId) fail("CORRUPT_STATE", "Current build belongs to another work.");
    if (sameBuildFingerprint(currentBuild.fingerprint, fingerprint)) {
      return immutableCopy({ work, build: currentBuild, resumed: true }) as BeginOrResumeBuildResult;
    }

    const timestamp = nowIso(this.#now);
    const buildId = randomUUID();
    const build: MutableBuildRecord = {
      schemaVersion: PREPARATION_WORK_SCHEMA_VERSION,
      workId: work.workId,
      buildId,
      revision: 0,
      fingerprint,
      selectionRevision: 0,
      selectionFingerprint: null,
      stages: {},
      artifacts: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const nextWork: MutableWorkRecord = {
      ...work,
      revision: work.revision + 1,
      currentBuildId: buildId,
      buildIds: [...work.buildIds, buildId],
      updatedAt: timestamp,
    };
    await ensureSafeDirectory(this.root, `builds/${buildId}/artifacts`);
    await atomicWriteJson(this.#buildRecordPath(buildId), build);
    await atomicWriteJson(this.#workPath(), nextWork);
    return immutableCopy({ work: nextWork, build, resumed: false }) as BeginOrResumeBuildResult;
  }

  async setActiveSetRef(input: {
    expectedRevision: number;
    activeSetRef: ActiveSetReference | null;
  }): Promise<PreparationWorkRecord> {
    await this.#assertOwned();
    assertRevision(input.expectedRevision, "expectedRevision");
    const raw = await readJsonFile(this.#workPath());
    const work = parseWorkRecord(raw);
    if (work.revision !== input.expectedRevision) {
      throw new PreparationRevisionConflictError("work", input.expectedRevision, work.revision);
    }
    let activeSetRef: ActiveSetReference | null = null;
    if (input.activeSetRef !== null) {
      if (typeof input.activeSetRef.setId !== "string" || input.activeSetRef.setId.trim().length === 0) {
        fail("INVALID_ACTIVE_SET", "Active setId must be non-empty.");
      }
      if (input.activeSetRef.buildId !== null && typeof input.activeSetRef.buildId !== "string") {
        fail("INVALID_ACTIVE_SET", "Active buildId must be a string or null.");
      }
      activeSetRef = cloneJson(input.activeSetRef);
    }
    const next: MutableWorkRecord = {
      ...work,
      activeSetRef,
      revision: work.revision + 1,
      updatedAt: nowIso(this.#now),
    };
    await atomicWriteJson(this.#workPath(), next);
    return immutableCopy(next);
  }

  async prepareArtifactPath(buildId: string, relativePath: string) {
    await this.#assertOwned();
    await this.#assertCurrentBuild(buildId);
    const work = await this.readWork();
    if (!work || !work.buildIds.includes(buildId)) fail("BUILD_NOT_FOUND", "Build is not registered.");
    const normalized = normalizeArtifactRelativePath(relativePath);
    const directory = path.posix.dirname(normalized);
    if (directory !== ".") {
      await ensureSafeDirectory(this.#artifactRoot(buildId), directory);
    }
    await assertNoSymlinkComponents(this.#artifactRoot(buildId), normalized, false);
    return path.join(this.#artifactRoot(buildId), ...normalized.split("/"));
  }

  async #artifactAbsolutePath(buildId: string, relativePath: string) {
    const normalized = normalizeArtifactRelativePath(relativePath);
    const artifactRoot = this.#artifactRoot(buildId);
    await assertNoSymlinkComponents(artifactRoot, normalized, true);
    const candidate = path.join(artifactRoot, ...normalized.split("/"));
    const relative = path.relative(artifactRoot, candidate);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      fail("UNSAFE_PATH", "Artifact escaped its build-scoped directory.");
    }
    return candidate;
  }

  async #writeBuild(build: MutableBuildRecord) {
    await this.#assertOwned();
    await atomicWriteJson(this.#buildRecordPath(build.buildId), build);
    return immutableCopy(build) as PreparationBuildRecord;
  }

  async recordArtifact(input: RecordArtifactInput): Promise<PreparationBuildRecord> {
    await this.#assertOwned();
    assertUuid(input.buildId, "buildId");
    await this.#assertCurrentBuild(input.buildId);
    assertRevision(input.expectedRevision, "expectedRevision");
    if (!ARTIFACT_KEY_PATTERN.test(input.key)) {
      fail("INVALID_ARTIFACT_KEY", "Artifact key must use letters, numbers, dot, colon, underscore, or dash.");
    }
    const normalizedPath = normalizeArtifactRelativePath(input.relativePath);
    const build = await this.#readMutableBuild(input.buildId);
    if (build.revision !== input.expectedRevision) {
      throw new PreparationRevisionConflictError("build", input.expectedRevision, build.revision);
    }
    const absolutePath = await this.#artifactAbsolutePath(input.buildId, normalizedPath);
    const fingerprint = await hashRegularFile(absolutePath);
    const timestamp = nowIso(this.#now);
    const nextRevision = build.revision + 1;
    const nextArtifacts = {
      ...build.artifacts,
      [input.key]: {
        key: input.key,
        relativePath: normalizedPath,
        sha256: fingerprint.sha256,
        bytes: fingerprint.bytes,
        recordedAt: timestamp,
        data: cloneJson(input.data ?? null),
      },
    };
    const nextStages = { ...build.stages };
    const referencedStageIndexes = PREPARATION_STAGE_ORDER
      .map((stage, index) => nextStages[stage]?.artifactKeys.includes(input.key) ? index : -1)
      .filter((index) => index >= 0);
    if (referencedStageIndexes.length > 0) {
      const first = Math.min(...referencedStageIndexes);
      for (let index = first; index < PREPARATION_STAGE_ORDER.length; index += 1) {
        delete nextStages[PREPARATION_STAGE_ORDER[index]];
      }
    }
    return this.#writeBuild({
      ...build,
      revision: nextRevision,
      artifacts: nextArtifacts,
      stages: nextStages,
      updatedAt: timestamp,
    });
  }

  async getReusableArtifact(buildId: string, key: string): Promise<ReusableArtifact | null> {
    assertUuid(buildId, "buildId");
    if (!ARTIFACT_KEY_PATTERN.test(key)) fail("INVALID_ARTIFACT_KEY", "Artifact key is invalid.");
    const build = await this.#readMutableBuild(buildId);
    const record = build.artifacts[key];
    if (!record) return null;
    let absolutePath: string;
    try {
      absolutePath = await this.#artifactAbsolutePath(buildId, record.relativePath);
      const fingerprint = await hashRegularFile(absolutePath);
      if (fingerprint.bytes !== record.bytes || fingerprint.sha256 !== record.sha256) return null;
    } catch (error) {
      if (error instanceof PreparationWorkStoreError) return null;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return immutableCopy({ record, absolutePath }) as ReusableArtifact;
  }

  async #assertPriorStagesReusable(build: MutableBuildRecord, stage: PreparationStage) {
    const stageIndex = PREPARATION_STAGE_ORDER.indexOf(stage);
    for (let index = 0; index < stageIndex; index += 1) {
      const prior = PREPARATION_STAGE_ORDER[index];
      if (!build.stages[prior]) {
        fail("STAGE_ORDER", `Stage ${stage} requires completed stage ${prior}.`);
      }
      const reusable = await this.#getReusableStageFromBuild(build, prior);
      if (!reusable) fail("STALE_STAGE", `Stage ${prior} outputs are missing or corrupt.`);
    }
  }

  async #getReusableStageFromBuild(build: MutableBuildRecord, stage: PreparationStage) {
    const record = build.stages[stage];
    if (!record) return null;
    for (const key of record.artifactKeys) {
      const artifact = build.artifacts[key];
      if (!artifact) return null;
      try {
        const absolutePath = await this.#artifactAbsolutePath(build.buildId, artifact.relativePath);
        const fingerprint = await hashRegularFile(absolutePath);
        if (fingerprint.bytes !== artifact.bytes || fingerprint.sha256 !== artifact.sha256) return null;
      } catch (error) {
        if (error instanceof PreparationWorkStoreError) return null;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    return record;
  }

  async getReusableStage(buildId: string, stage: PreparationStage): Promise<PreparationStageRecord | null> {
    assertUuid(buildId, "buildId");
    if (!PREPARATION_STAGE_ORDER.includes(stage)) fail("INVALID_STAGE", `Unknown stage: ${String(stage)}`);
    const build = await this.#readMutableBuild(buildId);
    const record = await this.#getReusableStageFromBuild(build, stage);
    return record ? immutableCopy(record) : null;
  }

  async completeStage(input: CompleteStageInput): Promise<PreparationBuildRecord> {
    await this.#assertOwned();
    assertUuid(input.buildId, "buildId");
    await this.#assertCurrentBuild(input.buildId);
    assertRevision(input.expectedRevision, "expectedRevision");
    assertNonEmptyFingerprint(input.inputFingerprint, "inputFingerprint");
    if (input.stage === ("slide_selection" as NonSelectionPreparationStage)
      || !PREPARATION_STAGE_ORDER.includes(input.stage)) {
      fail("INVALID_STAGE", "Use recordSelection for the slide_selection stage.");
    }
    const build = await this.#readMutableBuild(input.buildId);
    if (build.revision !== input.expectedRevision) {
      throw new PreparationRevisionConflictError("build", input.expectedRevision, build.revision);
    }
    await this.#assertPriorStagesReusable(build, input.stage);
    const artifactKeys = [...new Set(input.artifactKeys ?? [])];
    for (const key of artifactKeys) {
      if (!ARTIFACT_KEY_PATTERN.test(key) || !build.artifacts[key]) {
        fail("MISSING_ARTIFACT", `Stage output artifact is not recorded: ${key}`);
      }
      if (!(await this.#getReusableArtifactFromBuild(build, key))) {
        fail("STALE_ARTIFACT", `Stage output artifact is missing or corrupt: ${key}`);
      }
    }
    const timestamp = nowIso(this.#now);
    const nextRevision = build.revision + 1;
    const priorStageRevision = build.stages[input.stage]?.stageRevision ?? 0;
    const nextStages = { ...build.stages };
    const stageIndex = PREPARATION_STAGE_ORDER.indexOf(input.stage);
    for (let index = stageIndex + 1; index < PREPARATION_STAGE_ORDER.length; index += 1) {
      delete nextStages[PREPARATION_STAGE_ORDER[index]];
    }
    nextStages[input.stage] = {
      stage: input.stage,
      stageRevision: priorStageRevision + 1,
      buildRevision: nextRevision,
      inputFingerprint: input.inputFingerprint,
      artifactKeys,
      completedAt: timestamp,
      data: cloneJson(input.data ?? null),
    };
    return this.#writeBuild({
      ...build,
      revision: nextRevision,
      stages: nextStages,
      updatedAt: timestamp,
    });
  }

  async #getReusableArtifactFromBuild(build: MutableBuildRecord, key: string) {
    const record = build.artifacts[key];
    if (!record) return null;
    try {
      const absolutePath = await this.#artifactAbsolutePath(build.buildId, record.relativePath);
      const fingerprint = await hashRegularFile(absolutePath);
      return fingerprint.bytes === record.bytes && fingerprint.sha256 === record.sha256
        ? record
        : null;
    } catch (error) {
      if (error instanceof PreparationWorkStoreError) return null;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async recordSelection(input: RecordSelectionInput): Promise<PreparationBuildRecord> {
    await this.#assertOwned();
    assertUuid(input.buildId, "buildId");
    await this.#assertCurrentBuild(input.buildId);
    assertRevision(input.expectedRevision, "expectedRevision");
    assertRevision(input.expectedSelectionRevision, "expectedSelectionRevision");
    assertNonEmptyFingerprint(input.selectionFingerprint, "selectionFingerprint");
    const build = await this.#readMutableBuild(input.buildId);
    if (build.revision !== input.expectedRevision) {
      throw new PreparationRevisionConflictError("build", input.expectedRevision, build.revision);
    }
    if (build.selectionRevision !== input.expectedSelectionRevision) {
      throw new PreparationRevisionConflictError(
        "selection",
        input.expectedSelectionRevision,
        build.selectionRevision,
      );
    }
    await this.#assertPriorStagesReusable(build, "slide_selection");
    const selectionUnchanged = build.selectionFingerprint === input.selectionFingerprint;
    if (selectionUnchanged && build.stages.slide_selection) {
      return immutableCopy(build) as PreparationBuildRecord;
    }
    const timestamp = nowIso(this.#now);
    const nextRevision = build.revision + 1;
    const nextSelectionRevision = selectionUnchanged
      ? build.selectionRevision
      : build.selectionRevision + 1;
    const nextStages = { ...build.stages };
    delete nextStages.high_resolution_conversion;
    nextStages.slide_selection = {
      stage: "slide_selection",
      stageRevision: (build.stages.slide_selection?.stageRevision ?? 0) + 1,
      buildRevision: nextRevision,
      inputFingerprint: input.selectionFingerprint,
      artifactKeys: [],
      completedAt: timestamp,
      data: cloneJson(input.data ?? null),
    };
    return this.#writeBuild({
      ...build,
      revision: nextRevision,
      selectionRevision: nextSelectionRevision,
      selectionFingerprint: input.selectionFingerprint,
      stages: nextStages,
      updatedAt: timestamp,
    });
  }
}

export async function openPreparationWorkStore(options: OpenPreparationWorkStoreOptions) {
  return PreparationWorkStore.open(options);
}
