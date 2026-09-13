import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareLocalPptx } from "./pipeline.ts";
import { initializePptxRedactions } from "./redaction-service.ts";
import { startLocalReviewServer, type LocalReviewServerHandle } from "./local-review-server.ts";
import { withVerifiedProductionMockupSnapshot } from "./mockup-service.ts";
import type { ProductionMockupSnapshot } from "./production-snapshot-types.ts";
import { getPreparationReview, preparePreparationReviewEvidence, readPreparationReviewEvidence, applyPreparationReview } from "./preparation-review-service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
export const BRIDGE_VERSION = "mockup-bridge-1";
export const BRIDGE_WORKER_VERSION = "2.10.0";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(code: string): never { throw new Error(code); }
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

export type ProductionBridgeSettings = Readonly<{ serverUrl: string; workerId: string; workerName: string; secret: string }>;
export type ProductionBridgeSession = Readonly<{ id: string; workItemId: string; mode: "full";
  sourceUrl: string; sourceAuthorization: string | null; fileName: string; sourceBindingHash: string; sourceHash?: string }>;
export type ProductionBridgeTransport = Readonly<{
  claim(): Promise<ProductionBridgeSession | null>;
  post(sessionId: string, body: Json): Promise<Json>;
  download(session: ProductionBridgeSession): Promise<Buffer>;
  stage(session: Pick<ProductionBridgeSession, "id" | "workItemId">, snapshot: ProductionMockupSnapshot): Promise<{ sessionId: string; staged: true }>;
}>;

export function publicProductionBridgeError(error: unknown) {
  const value = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[A-Z][A-Z0-9_]{1,120}$/.test(value) ? value : "MOCKUP_BRIDGE_OPERATION_FAILED";
}
export function validateBridgeSettings(value: ProductionBridgeSettings): ProductionBridgeSettings {
  if (value.serverUrl !== "https://woolim-site.vercel.app" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(value.workerId)
    || !value.workerName?.trim() || value.workerName.length > 80 || /[\x00-\x1f\x7f]/.test(value.workerName)
    || typeof value.secret !== "string" || !value.secret || /[\r\n]/.test(value.secret)) fail("MOCKUP_BRIDGE_SETTINGS_INVALID");
  return Object.freeze({ ...value });
}
export function validateBridgeSession(value: unknown): ProductionBridgeSession {
  const session = object(value);
  if (!UUID.test(String(session.id)) || !UUID.test(String(session.workItemId)) || session.mode !== "full"
    || !SHA.test(String(session.sourceBindingHash)) || typeof session.sourceUrl !== "string"
    || typeof session.fileName !== "string" || session.fileName.length > 255 || !/\.pptx$/i.test(session.fileName)
    || (session.sourceAuthorization !== null && typeof session.sourceAuthorization !== "string")
    || /[\r\n]/.test(String(session.sourceAuthorization ?? ""))
    || (session.sourceHash !== undefined && !SHA.test(String(session.sourceHash)))) fail("MOCKUP_BRIDGE_SESSION_INVALID");
  validateBridgeDownloadUrl(session.sourceUrl);
  return { id: String(session.id).toLowerCase(), workItemId: String(session.workItemId).toLowerCase(), mode: "full",
    sourceUrl: session.sourceUrl, sourceAuthorization: session.sourceAuthorization as string | null,
    fileName: session.fileName, sourceBindingHash: String(session.sourceBindingHash),
    ...(session.sourceHash ? { sourceHash: String(session.sourceHash) } : {}) };
}
/** Fixed provider families only. No client-provided arbitrary host, userinfo, port or private IP is contacted. */
export function validateBridgeDownloadUrl(value: string, upload = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { fail("MOCKUP_BRIDGE_DOWNLOAD_URL_INVALID"); }
  const allowed = upload ? ["supabase.co"] : ["supabase.co", "worksapis.com", "worksmobile.com", "worksdrive.com", "naverworks.com", "naver.com", "ncloud.com", "navercloud.com"];
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || !allowed.some((suffix) => url.hostname.endsWith(`.${suffix}`))) fail("MOCKUP_BRIDGE_DOWNLOAD_HOST_REJECTED");
  return url;
}
async function boundedBody(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maximum) { await response.body?.cancel(); fail("MOCKUP_BRIDGE_RESPONSE_TOO_LARGE"); }
  if (!response.body) fail("MOCKUP_BRIDGE_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) fail("MOCKUP_BRIDGE_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createProductionBridgeTransport(settingsInput: ProductionBridgeSettings,
  dependencies: { fetch?: typeof fetch } = {}): ProductionBridgeTransport {
  const settings = validateBridgeSettings(settingsInput), request = dependencies.fetch ?? fetch;
  async function api(route: string, body: Json) {
    if (!/^\/api\/worker\/mockup-sessions\/(?:claim|[a-f0-9-]{36})$/.test(route)) fail("MOCKUP_BRIDGE_ROUTE_INVALID");
    try {
      const response = await request(`${settings.serverUrl}${route}`, { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.secret}`, "X-Woolim-Worker-Id": settings.workerId },
        body: JSON.stringify({ ...body, workerId: settings.workerId, workerName: settings.workerName,
          workerVersion: BRIDGE_WORKER_VERSION, bridgeVersion: BRIDGE_VERSION }), signal: AbortSignal.timeout(300_000) });
      const result = object(JSON.parse((await boundedBody(response, 1024 * 1024)).toString("utf8")));
      if (!response.ok) fail(typeof result.error === "string" && /^(?:MOCKUP|IMAGE_SET|THUMBNAIL)_[A-Z0-9_]+$/.test(result.error)
        ? result.error : "MOCKUP_BRIDGE_SERVER_REJECTED");
      return result;
    } catch (error) { throw new Error(publicProductionBridgeError(error)); }
  }
  const post = (sessionId: string, body: Json) => {
    if (!UUID.test(sessionId)) fail("MOCKUP_BRIDGE_SESSION_INVALID");
    return api(`/api/worker/mockup-sessions/${sessionId}`, body);
  };
  return {
    post,
    async claim() {
      const result = await api("/api/worker/mockup-sessions/claim", {});
      return result.session === null ? null : validateBridgeSession(result.session);
    },
    async download(session) {
      let url = validateBridgeDownloadUrl(session.sourceUrl);
      const initialOrigin = url.origin;
      try {
        for (let redirects = 0; redirects <= 3; redirects++) {
          const response = await request(url.href, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(180_000),
            headers: session.sourceAuthorization && url.origin === initialOrigin ? { Authorization: session.sourceAuthorization } : {} });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location || redirects === 3) fail("MOCKUP_BRIDGE_DOWNLOAD_REDIRECT_REJECTED");
            url = validateBridgeDownloadUrl(new URL(location, url).href);
            continue;
          }
          if (!response.ok) fail("MOCKUP_BRIDGE_SOURCE_DOWNLOAD_FAILED");
          const bytes = await boundedBody(response, 256 * 1024 * 1024);
          if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail("MOCKUP_BRIDGE_SOURCE_NOT_PPTX");
          if (session.sourceHash && hash(bytes) !== session.sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
          return bytes;
        }
        fail("MOCKUP_BRIDGE_SOURCE_DOWNLOAD_FAILED");
      } catch (error) { throw new Error(publicProductionBridgeError(error)); }
    },
    async stage(session, snapshot) {
      if (!UUID.test(session.id) || !UUID.test(session.workItemId) || snapshot.descriptor.mode !== "full") fail("MOCKUP_BRIDGE_SESSION_INVALID");
      const plan = await post(session.id, { action: "prepare-upload", descriptor: snapshot.descriptor, snapshotHash: snapshot.snapshotHash });
      const expected = new Map<string, { bytes: Buffer; sha256: string; path: string }>([...snapshot.boards.map((board, index) => [String(index), { bytes: board.png, sha256: board.imageHash,
        path: `verified-local/${session.workItemId}/${session.id}/${index}.png` }] as const),
      ["base", { bytes: snapshot.titlelessBasePng, sha256: snapshot.descriptor.thumbnail.baseImageHash,
        path: `verified-local/${session.workItemId}/${session.id}/titleless.png` }] as const]);
      if (plan.sessionId !== session.id || plan.snapshotHash !== snapshot.snapshotHash || !Array.isArray(plan.uploads)
        || plan.uploads.length !== expected.size) fail("MOCKUP_BRIDGE_UPLOAD_PLAN_INVALID");
      const seen = new Set<string>();
      const uploads = plan.uploads.map((value: unknown) => {
        const upload = object(value), key = String(upload.key), target = expected.get(key);
        if (!target || seen.has(key) || upload.path !== target.path || upload.sha256 !== target.sha256
          || target.bytes.length > 12 * 1024 * 1024 || hash(target.bytes) !== target.sha256 || typeof upload.signedUrl !== "string") fail("MOCKUP_BRIDGE_UPLOAD_PLAN_INVALID");
        seen.add(key);
        const url = validateBridgeDownloadUrl(upload.signedUrl, true);
        if (decodeURIComponent(url.pathname) !== `/storage/v1/object/upload/sign/portfolio-rendered/${target.path}`) fail("MOCKUP_BRIDGE_UPLOAD_PATH_INVALID");
        return { url, bytes: target.bytes };
      });
      for (const upload of uploads) {
        let response: Response;
        try { response = await request(upload.url.href, { method: "PUT", redirect: "error", headers: { "Content-Type": "image/png", "x-upsert": "false" },
          body: new Uint8Array(upload.bytes), signal: AbortSignal.timeout(120_000) }); }
        catch { fail("MOCKUP_BRIDGE_UPLOAD_FAILED"); }
        if (!response.ok && response.status !== 409) {
          // A duplicate is not proof of success. The final server stage reads and hashes EVERY object.
          const error = object(JSON.parse((await boundedBody(response, 16 * 1024)).toString("utf8")));
          if (response.status !== 400 || !["Duplicate", "ResourceAlreadyExists"].includes(String(error.error ?? error.code))) fail("MOCKUP_BRIDGE_UPLOAD_FAILED");
        } else await response.body?.cancel();
      }
      const staged = await post(session.id, { action: "stage", snapshotHash: snapshot.snapshotHash });
      if (staged.sessionId !== session.id || staged.staged !== true) fail("MOCKUP_BRIDGE_STAGE_RECEIPT_INVALID");
      return { sessionId: session.id, staged: true };
    },
  };
}

type SessionRecord = { version: 1; sessionId: string; workItemId: string; sourceHash: string;
  sourceBindingHash: string; buildId: string; workId: string; workDirectory?: string;
  state: "review" | "staged" | "failed" | "cancelled" | "activated" };
export type ProductionBridgeDependencies = {
  prepare?: typeof prepareLocalPptx;
  redact?: typeof initializePptxRedactions;
  serve?: typeof startLocalReviewServer;
  withSnapshot?: typeof withVerifiedProductionMockupSnapshot;
  review?: {
    get?: typeof getPreparationReview;
    prepareEvidence?: typeof preparePreparationReviewEvidence;
    readEvidence?: typeof readPreparationReviewEvidence;
    apply?: typeof applyPreparationReview;
  };
};
async function safeDirectory(directory: string) {
  if (!path.isAbsolute(directory)) fail("MOCKUP_BRIDGE_PRIVATE_ROOT_INVALID");
  const absolute = path.resolve(directory); let cursor = path.parse(absolute).root;
  for (const segment of path.relative(cursor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try { await mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("MOCKUP_BRIDGE_PRIVATE_ROOT_INVALID");
  }
  return absolute;
}
async function saveRecord(directory: string, record: SessionRecord) {
  const target = path.join(directory, "bridge-session.json"), temporary = path.join(directory, `.bridge-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

/** Polls only the explicit admin-created session queue. No legacy claim, content generation or AI call. */
export async function createProductionMockupBridge(input: { privateRoot: string; transport: ProductionBridgeTransport;
  onEvent?: (event: { code: string; sessionId?: string }) => void }, dependencies: ProductionBridgeDependencies = {}) {
  if (!path.isAbsolute(input.privateRoot) || path.basename(input.privateRoot) !== "p"
    || path.basename(path.dirname(input.privateRoot)) !== "WoolimWorker") fail("MOCKUP_BRIDGE_PRIVATE_ROOT_INVALID");
  const root = await safeDirectory(input.privateRoot);
  const active = new Map<string, { server: LocalReviewServerHandle; record: SessionRecord }>();
  const retired = new Set<LocalReviewServerHandle>();
  let processing = false;
  const event = (code: string, sessionId?: string) => input.onEvent?.({ code, ...(sessionId ? { sessionId } : {}) });
  async function remoteReviewIsOpen(directory: string, record: SessionRecord, server?: LocalReviewServerHandle) {
    const response = await input.transport.post(record.sessionId, { action: "status" });
    if (response.sessionId !== record.sessionId || !["preparing", "review", "uploading", "staged", "activated", "failed", "cancelled"].includes(String(response.status))) {
      fail("MOCKUP_BRIDGE_STATUS_INVALID");
    }
    if (["staged", "activated", "failed", "cancelled"].includes(String(response.status))) {
      record.state = response.status as SessionRecord["state"];
      await saveRecord(directory, record);
      event("MOCKUP_REVIEW_CLOSED", record.sessionId);
      return false;
    }
    if (response.reopenRequested === true && server) {
      if (!server.issueLaunchUrl) fail("MOCKUP_BRIDGE_REOPEN_UNAVAILABLE");
      const localReviewUrl = await server.issueLaunchUrl();
      await input.transport.post(record.sessionId, { action: "progress", status: "review", sourceHash: record.sourceHash, localReviewUrl });
      event("MOCKUP_REVIEW_REOPENED", record.sessionId);
    }
    return true;
  }
  const workDirectory = (record: SessionRecord) => {
    const name = record.workDirectory ?? "w";
    if (!/^w(?:[a-f0-9]{8})?$/.test(name)) fail("MOCKUP_BRIDGE_RESUME_RECORD_INVALID");
    return name;
  };
  const requireActiveReview = (record: SessionRecord) => {
    if (active.get(record.sessionId)?.record !== record || record.state !== "review") fail("MOCKUP_BRIDGE_REVIEW_STALE");
  };
  async function exclusivePreparation<T>(record: SessionRecord, action: () => Promise<T>) {
    requireActiveReview(record);
    if (processing) fail("MOCKUP_BRIDGE_PREPARATION_BUSY");
    processing = true;
    try { return await action(); } finally { processing = false; }
  }
  async function requireRemoteEditable(record: SessionRecord) {
    const response = await input.transport.post(record.sessionId, { action: "status" });
    if (response.sessionId !== record.sessionId || response.status !== "review") fail("MOCKUP_BRIDGE_REVIEW_NOT_EDITABLE");
  }
  async function verifiedLocalSource(directory: string, record: SessionRecord) {
    const sourcePath = path.join(directory, "s", "source.pptx"), info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256 * 1024 * 1024) fail("MOCKUP_SOURCE_HASH_CHANGED");
    const bytes = await readFile(sourcePath);
    if (hash(bytes) !== record.sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
    return { sourcePath, bytes };
  }
  async function openReview(directory: string, record: SessionRecord, replacement?: SessionRecord) {
    const identity = { root: path.join(directory, workDirectory(record)), buildId: record.buildId };
    const reviewIdentity = { sourcePath: path.join(directory, "s", "source.pptx"), workRoot: identity.root, workId: record.workId, buildId: record.buildId };
    const server = await (dependencies.serve ?? startLocalReviewServer)({ ...identity,
      preparationReview: {
        get: async () => { requireActiveReview(record); return (dependencies.review?.get ?? getPreparationReview)(reviewIdentity); },
        readEvidence: async (request) => { requireActiveReview(record); return (dependencies.review?.readEvidence ?? readPreparationReviewEvidence)(reviewIdentity, request); },
        prepareEvidence: async (request) => exclusivePreparation(record, async () => {
          await requireRemoteEditable(record);
          await verifiedLocalSource(directory, record);
          return (dependencies.review?.prepareEvidence ?? preparePreparationReviewEvidence)(reviewIdentity, request);
        }),
        apply: async (request) => exclusivePreparation(record, async () => {
          await requireRemoteEditable(record);
          const verified = await verifiedLocalSource(directory, record);
          const validate = () => (dependencies.review?.apply ?? applyPreparationReview)(reviewIdentity, request, { reviewedBy: "local-admin-review" });
          const options = await validate();
          // A failed preparation never changes the previous build/current pointer.
          // New private generation is activated only after every check succeeds.
          const generation = `w${randomUUID().replaceAll("-", "").slice(0, 8)}`;
          const workRoot = path.join(directory, generation);
          if (process.platform === "win32" && workRoot.length > 100) fail("WORK_ROOT_TOO_LONG");
          const prepared = await (dependencies.prepare ?? prepareLocalPptx)({ sourcePath: verified.sourcePath, workRoot,
            sourceFormatChoice: options.sourceFormatChoice, artworkReviews: options.artworkReviews });
          if (prepared.inspection.sourceHash !== record.sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
          if (prepared.status !== "held") await (dependencies.redact ?? initializePptxRedactions)({ root: workRoot, buildId: prepared.buildId,
            source: verified.bytes, slideNumbers: [...prepared.selection.selected, ...prepared.selection.reserves] });
          await verifiedLocalSource(directory, record);
          await validate(); // Re-check the same old revision/source/evidence; do not regenerate approval timestamps.
          requireActiveReview(record);
          await requireRemoteEditable(record);
          const next: SessionRecord = { ...record, workDirectory: generation, buildId: prepared.buildId, workId: prepared.workId, state: "review" };
          const launchUrl = await openReview(directory, next, record);
          return { applied: true, buildId: next.buildId, launchUrl };
        }),
      },
      productionBridge: { sessionId: record.sessionId, workItemId: record.workItemId, stage: async (expectedSnapshotHash) => exclusivePreparation(record, async () => {
        const result = await (dependencies.withSnapshot ?? withVerifiedProductionMockupSnapshot)(identity, { mode: "full", expectedSnapshotHash }, async (snapshot) => {
          if (snapshot.descriptor.sourceHash !== record.sourceHash || snapshot.descriptor.localWorkId !== record.workId) fail("MOCKUP_BRIDGE_SOURCE_BINDING_CHANGED");
          return input.transport.stage({ id: record.sessionId, workItemId: record.workItemId }, snapshot);
        });
        record.state = "staged";
        await saveRecord(directory, record);
        event("MOCKUP_CANDIDATE_STAGED", record.sessionId);
        return result;
      }) } });
    try {
      if (!server.launchUrl) fail("MOCKUP_BRIDGE_LAUNCH_URL_MISSING");
      if (replacement) requireActiveReview(replacement);
      await input.transport.post(record.sessionId, { action: "progress", status: "review", sourceHash: record.sourceHash, localReviewUrl: server.launchUrl });
      if (replacement) await saveRecord(directory, record);
      const previous = active.get(record.sessionId);
      active.set(record.sessionId, { server, record });
      if (replacement && previous) retired.add(previous.server);
      event("MOCKUP_REVIEW_READY", record.sessionId);
      return server.launchUrl;
    } catch (error) { await server.close(); throw error; }
  }
  return {
    async resume() {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        const directory = await safeDirectory(path.join(root, entry.name));
        const recordPath = path.join(directory, "bridge-session.json");
        try {
          const info = await lstat(recordPath);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) fail("MOCKUP_BRIDGE_RESUME_RECORD_INVALID");
          const record = JSON.parse(await readFile(recordPath, "utf8")) as SessionRecord;
          if (record.version !== 1 || record.sessionId !== entry.name || !UUID.test(record.workItemId)
            || !UUID.test(record.buildId) || !UUID.test(record.workId) || !SHA.test(record.sourceHash) || !SHA.test(record.sourceBindingHash)
            || !["review", "staged", "failed", "cancelled", "activated"].includes(record.state)) fail("MOCKUP_BRIDGE_RESUME_RECORD_INVALID");
          workDirectory(record);
          if (record.state !== "review" || active.has(record.sessionId)) continue;
          // Confirm the owned server session before reading source bytes or
          // reopening a local editor after a restart. Cancellation is final.
          if (!await remoteReviewIsOpen(directory, record)) continue;
          await safeDirectory(path.join(directory, "s"));
          const sourcePath = path.join(directory, "s", "source.pptx"), sourceInfo = await lstat(sourcePath);
          if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.nlink !== 1 || sourceInfo.size > 256 * 1024 * 1024
            || hash(await readFile(sourcePath)) !== record.sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
          await openReview(directory, record);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") event(publicProductionBridgeError(error), entry.name); }
      }
      return { resumed: active.size };
    },
    async tick() {
      if (processing) return { claimed: false, busy: true };
      processing = true;
      let session: ProductionBridgeSession | null = null;
      try {
        for (const server of retired) { await server.close(); retired.delete(server); }
        for (const [id, entry] of active) {
          const stillOpen = entry.record.state === "review"
            && await remoteReviewIsOpen(path.join(root, id), entry.record, entry.server);
          if (!stillOpen) { await entry.server.close(); active.delete(id); }
        }
        if (active.size >= 3) return { claimed: false, busy: true };
        session = await input.transport.claim();
        if (!session) return { claimed: false, busy: false };
        session = validateBridgeSession(session);
        const directory = await safeDirectory(path.join(root, session.id));
        const sourceDirectory = await safeDirectory(path.join(directory, "s"));
        const sourcePath = path.join(sourceDirectory, "source.pptx"), workRoot = path.join(directory, "w");
        if (process.platform === "win32" && workRoot.length > 100) fail("WORK_ROOT_TOO_LONG");
        const bytes = await input.transport.download(session), sourceHash = hash(bytes);
        try { await writeFile(sourcePath, bytes, { flag: "wx", mode: 0o600 }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const info = await lstat(sourcePath);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== bytes.length || hash(await readFile(sourcePath)) !== sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
        }
        await input.transport.post(session.id, { action: "progress", status: "preparing", sourceHash });
        const prepared = await (dependencies.prepare ?? prepareLocalPptx)({ sourcePath, workRoot });
        if (prepared.inspection.sourceHash !== sourceHash) fail("MOCKUP_SOURCE_HASH_CHANGED");
        if (prepared.status !== "held") await (dependencies.redact ?? initializePptxRedactions)({ root: workRoot, buildId: prepared.buildId,
          source: bytes, slideNumbers: [...prepared.selection.selected, ...prepared.selection.reserves] });
        const record: SessionRecord = { version: 1, sessionId: session.id, workItemId: session.workItemId, sourceHash,
          sourceBindingHash: session.sourceBindingHash, buildId: prepared.buildId, workId: prepared.workId, state: "review" };
        await saveRecord(directory, record);
        await openReview(directory, record);
        return { claimed: true, busy: false };
      } catch (error) {
        const code = publicProductionBridgeError(error);
        if (session) await input.transport.post(session.id, { action: "progress", status: "failed", errorCode: code }).catch(() => undefined);
        event(code, session?.id);
        return { claimed: Boolean(session), busy: false, errorCode: code };
      } finally { processing = false; }
    },
    async close() { await Promise.all([...active.values()].map(({ server }) => server.close()).concat([...retired].map(server => server.close()))); active.clear(); retired.clear(); },
  };
}
