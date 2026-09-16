import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { openPreparationWorkStore, type PreparationWorkStore } from "./work-store.ts";
import type { PptxInspection } from "./pptx-inspection.ts";
import type { RedactionDetection, RedactionException, RedactionManualResolution, RedactionRegion, RedactionReview, RedactionState } from "./redaction-types.ts";
import { REDACTION_RULE_VERSION } from "./redaction-types.ts";
import { decodeRedactionPng, redactionHash, redactionHolds, redactionInputFingerprint, renderRedactedPng, validRedactionRect, assertFlatRedactionPng, assertRedactionComplexity, validManualRedactionResolution, containsRedactionRect } from "./redaction-renderer.ts";
import { detectPptxRedactionCandidates } from "./redaction-detection.ts";

export type RedactionIdentity = { root: string; buildId: string; sourceSlideNumber: number };
const idPattern = /^[a-zA-Z0-9:_-]{1,100}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const candidatePolicy = new Map<string, boolean>([
  ...["email", "contact", "identifier", "account", "authentication", "address", "qr", "barcode", "signature", "object_review"].map((category) => [category, true] as const),
  ...["name", "amount", "internal_detail", "image_review", "chart_review"].map((category) => [category, false] as const),
]);
function fail(code: string): never { throw new Error(code); }
function text(value: unknown, max: number) { return typeof value === "string" && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value); }
function checkRevision(state: RedactionState, expected: number) {
  if (!Number.isSafeInteger(expected) || expected !== state.revision) fail("REDACTION_REVISION_CONFLICT");
}
async function locked<T>(root: string, operation: (store: PreparationWorkStore) => Promise<T>): Promise<T> {
  const store = await openPreparationWorkStore({ root });
  try { return await operation(store); } finally { await store.release(); }
}
async function preparationContext(store: PreparationWorkStore, input: { buildId: string }) {
  const work = await store.readWork();
  if (!work || work.currentBuildId !== input.buildId) fail("REDACTION_BUILD_NOT_CURRENT");
  const build = await store.readBuild(input.buildId);
  const conversion = await store.getReusableStage(input.buildId, "high_resolution_conversion");
  const selection = await store.getReusableStage(input.buildId, "slide_selection");
  const inspected = await store.getReusableStage(input.buildId, "source_inspection");
  if (!conversion || !selection || !inspected) fail("REDACTION_PREPARATION_INCOMPLETE");
  const group = selection.data as unknown as { selected: number[]; reserves: number[]; status: string };
  if (group.status === "held") fail("REDACTION_SLIDE_NOT_SELECTED");
  const inspection = inspected.data as unknown as PptxInspection;
  if (inspection.sourceHash !== build.fingerprint.source.sha256) fail("REDACTION_INSPECTION_SOURCE_MISMATCH");
  return { work, build, group, inspection };
}
type VerifiedPreparationContext = Awaited<ReturnType<typeof preparationContext>>;
async function context(store: PreparationWorkStore, input: RedactionIdentity, prepared?: VerifiedPreparationContext) {
  if (!Number.isSafeInteger(input.sourceSlideNumber) || input.sourceSlideNumber < 1) fail("INVALID_SLIDE_NUMBER");
  const { work, build, group, inspection } = prepared ?? await preparationContext(store, input);
  if (![...group.selected, ...group.reserves].includes(input.sourceSlideNumber)) fail("REDACTION_SLIDE_NOT_SELECTED");
  const slide = inspection.slides.find((s) => s.sourceSlideNumber === input.sourceSlideNumber);
  const image = await store.getReusableArtifact(input.buildId, `highres:${input.sourceSlideNumber}`);
  if (!slide || !image) fail("REDACTION_HIGHRES_MISSING");
  const bytes = await readFile(image.absolutePath);
  if (redactionHash(bytes) !== image.record.sha256) fail("REDACTION_SOURCE_CHANGED");
  return { work, build, slide, bytes, imageHash: image.record.sha256 };
}
function validateDetection(detection: RedactionDetection) {
  if (!shaPattern.test(detection.sourceHash) || !shaPattern.test(detection.slideContentHash)
    || !Array.isArray(detection.candidates) || detection.candidates.length > 500
    || !Array.isArray(detection.warnings) || detection.warnings.length > 500) fail("INVALID_REDACTION_DETECTION");
  const ids = new Set<string>();
  for (const c of detection.candidates) {
    if (!c || !idPattern.test(c.id) || ids.has(c.id) || !validRedactionRect(c.rect)
      || candidatePolicy.get(c.category) !== c.required || !/^[A-Z_]{1,160}$/.test(c.reason)) fail("INVALID_REDACTION_CANDIDATE");
    ids.add(c.id);
  }
  if (detection.warnings.some((w) => typeof w !== "string" || !/^[A-Z_]{1,160}$/.test(w))) fail("INVALID_REDACTION_WARNING");
  if (detection.uncertainties !== undefined && (!Array.isArray(detection.uncertainties) || detection.uncertainties.length > 500)) fail("INVALID_REDACTION_UNCERTAINTIES");
  const uncertaintyIds = new Set<string>();
  for (const item of detection.uncertainties ?? []) {
    const candidate = detection.candidates.find((entry) => entry.id === item?.candidateId);
    if (!item || !idPattern.test(item.id) || uncertaintyIds.has(item.id) || !candidate || !validRedactionRect(item.rect)
      || !containsRedactionRect(item.rect, candidate.rect)
      || !["TEXT_RENDER_BOUNDS_UNRESOLVED", "TEXT_GEOMETRY_UNRESOLVED", "IMAGE_GEOMETRY_UNRESOLVED"].includes(item.code)) fail("INVALID_REDACTION_UNCERTAINTY");
    uncertaintyIds.add(item.id);
  }
}
function validateManualResolutions(state: RedactionState, resolutions: RedactionManualResolution[]) {
  if (!Array.isArray(resolutions) || resolutions.length > 500) fail("INVALID_MANUAL_REDACTION_REVIEWS");
  const ids = new Set<string>();
  for (const item of resolutions) {
    if (!item || ids.has(item.uncertaintyId) || !text(item.actor, 100) || !text(item.reason, 500)
      || !validManualRedactionResolution(state, item)) fail("MANUAL_REDACTION_REVIEW_STALE_OR_INVALID");
    ids.add(item.uncertaintyId);
  }
}
function validateEdits(state: RedactionState, regions: RedactionRegion[], exceptions: RedactionException[], review: RedactionReview) {
  if (!Array.isArray(regions) || regions.length > 500 || !Array.isArray(exceptions) || exceptions.length > 500) fail("INVALID_REDACTION_EDITS");
  const ids = new Set<string>(), candidateIds = new Set(state.candidates.map((c) => c.id));
  for (const r of regions) {
    if (!r || !idPattern.test(r.id) || ids.has(r.id) || !validRedactionRect(r.rect)
      || !["opaque", "blur"].includes(r.mode) || (r.candidateId !== undefined && !candidateIds.has(r.candidateId))) fail("INVALID_REDACTION_REGION");
    if (state.candidates.find((c) => c.id === r.candidateId)?.required && r.mode !== "opaque") fail("REQUIRED_REGION_MUST_BE_OPAQUE");
    ids.add(r.id);
  }
  assertRedactionComplexity(regions);
  const exceptionIds = new Set<string>();
  for (const e of exceptions) {
    if (!e || !candidateIds.has(e.candidateId) || exceptionIds.has(e.candidateId)
      || !text(e.actor, 100) || !e.actor.trim() || !text(e.reason, 500) || e.reason.trim().length < 3) fail("PUBLIC_EXCEPTION_NEEDS_ACTOR_AND_REASON");
    exceptionIds.add(e.candidateId);
  }
  if (!review || !text(review.reviewer, 100) || typeof review.originalInspected !== "boolean" || typeof review.layoutAcceptable !== "boolean") fail("INVALID_REDACTION_REVIEW");
}
async function writeArtifact(store: PreparationWorkStore, identity: RedactionIdentity, key: string, extension: string, bytes: Buffer | string) {
  const build = await store.readBuild(identity.buildId);
  const relativePath = `redaction/${identity.sourceSlideNumber}/${randomUUID()}.${extension}`;
  const destination = await store.prepareArtifactPath(identity.buildId, relativePath);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
  await store.recordArtifact({ buildId: identity.buildId, key, expectedRevision: build.revision, relativePath });
}
async function persist(store: PreparationWorkStore, input: RedactionIdentity, state: RedactionState) {
  await writeArtifact(store, input, `redaction-state:${input.sourceSlideNumber}`, "json", JSON.stringify(state));
  return structuredClone(state);
}
async function load(store: PreparationWorkStore, input: RedactionIdentity, prepared?: VerifiedPreparationContext) {
  const current = await context(store, input, prepared);
  const record = await store.getReusableArtifact(input.buildId, `redaction-state:${input.sourceSlideNumber}`);
  if (!record) fail("REDACTION_NOT_INITIALIZED");
  const bytes = await readFile(record.absolutePath);
  if (bytes.length > 2 * 1024 * 1024 || redactionHash(bytes) !== record.record.sha256) fail("REDACTION_STATE_CORRUPT");
  const state = JSON.parse(bytes.toString("utf8")) as RedactionState;
  if (state.version !== 1 || state.ruleVersion !== REDACTION_RULE_VERSION || state.buildId !== input.buildId
    || state.workId !== current.work.workId || state.sourceSlideNumber !== input.sourceSlideNumber
    || state.sourceHash !== current.build.fingerprint.source.sha256 || state.slideContentHash !== current.slide.contentHash
    || state.imageHash !== current.imageHash || !Number.isSafeInteger(state.revision) || state.revision < 0) fail("REDACTION_STATE_STALE");
  validateDetection({ ...state });
  validateEdits(state, state.regions, state.exceptions, state.review);
  validateManualResolutions(state, state.manualResolutions ?? []);
  return { state, ...current };
}

/** Trusted local dependency seam for synthetic tests. Not accepted by any HTTP endpoint.
 * Normal PPTX callers MUST use initializePptxRedactions so detections derive from the source bytes.
 */
export async function initializeLocalRedactions(input: { root: string; buildId: string; detections: RedactionDetection[] }) {
  return locked(input.root, async (store) => {
    const results: RedactionState[] = [];
    if (!Array.isArray(input.detections) || new Set(input.detections.map((d) => d.sourceSlideNumber)).size !== input.detections.length) fail("INVALID_REDACTION_DETECTIONS");
    for (const detection of input.detections) {
      validateDetection(detection);
      const identity = { ...input, sourceSlideNumber: detection.sourceSlideNumber };
      const current = await context(store, identity);
      if (detection.sourceHash !== current.build.fingerprint.source.sha256 || detection.slideContentHash !== current.slide.contentHash) fail("REDACTION_DETECTION_SOURCE_MISMATCH");
      const existing = await store.getReusableArtifact(input.buildId, `redaction-state:${detection.sourceSlideNumber}`);
      let previous: RedactionState | undefined;
      if (existing) {
        const bytes = await readFile(existing.absolutePath);
        if (redactionHash(bytes) !== existing.record.sha256) fail("REDACTION_STATE_CORRUPT");
        previous = JSON.parse(bytes.toString("utf8")) as RedactionState;
        if (previous.ruleVersion === REDACTION_RULE_VERSION && previous.imageHash === current.imageHash
          && previous.slideContentHash === detection.slideContentHash && previous.sourceHash === detection.sourceHash
          && JSON.stringify(previous.candidates) === JSON.stringify(detection.candidates) && JSON.stringify(previous.warnings) === JSON.stringify(detection.warnings)
          && JSON.stringify(previous.uncertainties ?? []) === JSON.stringify(detection.uncertainties ?? [])) {
          results.push((await load(store, identity)).state); continue;
        }
      }
      const { width, height } = await decodeRedactionPng(current.bytes);
      const state: RedactionState = { version: 1, ruleVersion: REDACTION_RULE_VERSION, workId: current.work.workId,
        buildId: input.buildId, ...detection, imageHash: current.imageHash, width, height, revision: (previous?.revision ?? -1) + 1,
        regions: detection.candidates.filter((c) => c.required).map((c) => ({ id: `auto-${redactionHash(c.id).slice(0, 24)}`, candidateId: c.id, rect: c.rect, mode: "opaque" })),
        exceptions: [], uncertainties: detection.uncertainties ?? [], manualResolutions: [],
        review: { reviewer: "", originalInspected: false, layoutAcceptable: true }, status: "editing", output: null };
      results.push(await persist(store, identity, state));
    }
    return results;
  });
}
export async function initializePptxRedactions(input: { root: string; buildId: string; source: Buffer; slideNumbers: readonly number[] }) {
  const detections = await detectPptxRedactionCandidates(input.source, input.slideNumbers);
  return initializeLocalRedactions({ root: input.root, buildId: input.buildId, detections });
}
export async function getLocalRedactionSlide(input: RedactionIdentity) {
  return locked(input.root, async (store) => structuredClone((await load(store, input)).state));
}
export async function saveLocalRedactionSlide(input: RedactionIdentity & { expectedRevision: number; regions: RedactionRegion[]; exceptions: RedactionException[]; review: RedactionReview; manualResolutions?: RedactionManualResolution[] }) {
  return locked(input.root, async (store) => {
    const { state } = await load(store, input);
    checkRevision(state, input.expectedRevision);
    validateEdits(state, input.regions, input.exceptions, input.review);
    // Explicit field projection prevents source text, arbitrary client metadata or old output receipts being persisted.
    const regions = input.regions.map((r) => ({ id: r.id, ...(r.candidateId ? { candidateId: r.candidateId } : {}),
      rect: { x: r.rect.x, y: r.rect.y, width: r.rect.width, height: r.rect.height }, mode: r.mode }));
    const exceptions = input.exceptions.map((e) => ({ candidateId: e.candidateId, actor: e.actor.trim(), reason: e.reason.trim() }));
    const review = { reviewer: input.review.reviewer.trim(), originalInspected: input.review.originalInspected, layoutAcceptable: input.review.layoutAcceptable };
    const editsUnchanged = JSON.stringify([regions, exceptions, review]) === JSON.stringify([state.regions, state.exceptions, state.review]);
    // Legacy clients may still edit, but cannot silently retain an inspection of a different draft.
    const requested = input.manualResolutions ?? (editsUnchanged ? state.manualResolutions ?? [] : []);
    const projectedState = { ...state, regions, exceptions, review };
    validateManualResolutions(projectedState, requested);
    for (const item of requested) {
      const retained = (state.manualResolutions ?? []).some((old) => JSON.stringify(old) === JSON.stringify(item));
      if (!retained && item.reviewedRevision !== state.revision) fail("MANUAL_REDACTION_REVIEW_REVISION_CONFLICT");
    }
    const manualResolutions = requested.map((item) => ({ uncertaintyId: item.uncertaintyId, decision: item.decision,
      actor: item.actor.trim(), reason: item.reason.trim(), inspectedAtActualSize: true as const, reviewedRevision: item.reviewedRevision,
      sourceHash: item.sourceHash, slideContentHash: item.slideContentHash, imageHash: item.imageHash,
      uncertaintyHash: item.uncertaintyHash, editHash: item.editHash, ...(item.regionId ? { regionId: item.regionId } : {}) }));
    if (editsUnchanged && JSON.stringify(manualResolutions) === JSON.stringify(state.manualResolutions ?? [])) return state;
    const next: RedactionState = { ...state, revision: state.revision + 1, regions, exceptions, review, manualResolutions, output: null, status: "editing" };
    next.status = review.originalInspected && !review.layoutAcceptable ? "replacement_required" : redactionHolds(next).length ? "needs_review" : "editing";
    return persist(store, input, next);
  });
}
export async function renderLocalRedactionSlide(input: RedactionIdentity & { expectedRevision: number }) {
  return locked(input.root, async (store) => {
    const { state, bytes } = await load(store, input);
    checkRevision(state, input.expectedRevision);
    if (state.output?.inputFingerprint === redactionInputFingerprint(state)) {
      const cached = await store.getReusableArtifact(input.buildId, state.output.artifactKey);
      if (cached?.record.sha256 === state.output.sha256) return state;
    }
    const rendered = await renderRedactedPng(bytes, state);
    const key = `redacted:${input.sourceSlideNumber}:${rendered.inputFingerprint.slice(0, 24)}`;
    await writeArtifact(store, input, key, "png", rendered.png);
    const next: RedactionState = { ...state, revision: state.revision + 1, status: "rendered", output: {
      artifactKey: key, sha256: rendered.sha256, width: rendered.width, height: rendered.height,
      inputFingerprint: rendered.inputFingerprint, checks: rendered.checks, createdAt: new Date().toISOString(), approvedAt: null, approvedBy: null } };
    return persist(store, input, next);
  });
}
async function verifiedBytes(store: PreparationWorkStore, input: RedactionIdentity, allowUnapproved = false, prepared?: VerifiedPreparationContext) {
  const { state } = await load(store, input, prepared);
  if (!state.output || state.output.inputFingerprint !== redactionInputFingerprint(state) || redactionHolds(state).length
    || (!allowUnapproved && (state.status !== "verified" || !state.output.approvedAt || !state.output.approvedBy))) fail("REDACTED_OUTPUT_NOT_APPROVED");
  const artifact = await store.getReusableArtifact(input.buildId, state.output.artifactKey);
  if (!artifact || artifact.record.sha256 !== state.output.sha256) fail("REDACTED_OUTPUT_CHANGED");
  const bytes = await readFile(artifact.absolutePath);
  if (redactionHash(bytes) !== state.output.sha256) fail("REDACTED_OUTPUT_CHANGED");
  assertFlatRedactionPng(bytes);
  return { state, bytes };
}
export async function approveLocalRedactionSlide(input: RedactionIdentity & { expectedRevision: number; outputHash: string; reviewer: string; outputInspected: boolean }) {
  return locked(input.root, async (store) => {
    const { state } = await verifiedBytes(store, input, true);
    checkRevision(state, input.expectedRevision);
    if (input.outputInspected !== true || !text(input.reviewer, 100) || !input.reviewer.trim() || state.output?.sha256 !== input.outputHash) fail("OUTPUT_REVIEW_REQUIRED");
    if (state.status === "verified") return state;
    return persist(store, input, { ...state, revision: state.revision + 1, status: "verified",
      output: { ...state.output!, approvedAt: new Date().toISOString(), approvedBy: input.reviewer.trim() } });
  });
}
export async function readSafeRedactedSlide(input: RedactionIdentity, options: { allowUnapproved?: boolean } = {}) {
  return locked(input.root, async (store) => (await verifiedBytes(store, input, options.allowUnapproved)).bytes);
}

/** Internal local composition seam. The caller owns this work-store lock for the
 * entire assignment/render operation. Unlike the editor's comparison endpoint,
 * this seam never permits an unapproved output or a separate unlocked receipt. */
export async function readVerifiedRedactedSlideFromStore(store: PreparationWorkStore, input: RedactionIdentity) {
  const verified = await verifiedBytes(store, input);
  return { state: structuredClone(verified.state), bytes: verified.bytes };
}

/** One request/one held store lock: validate the shared preparation checkpoint
 * once, then every requested receipt and PNG. Never keep this snapshot across
 * requests or mutations. Avoid rehashing the entire deck for every candidate. */
export async function readVerifiedRedactedSlidesFromStore(store: PreparationWorkStore,
  input: { root: string; buildId: string; slideNumbers: readonly number[] }) {
  const prepared = await preparationContext(store, input);
  const results = new Map<number, { state: RedactionState; bytes: Buffer } | { error: string }>();
  for (const sourceSlideNumber of input.slideNumbers) {
    try { results.set(sourceSlideNumber, await verifiedBytes(store, { ...input, sourceSlideNumber }, false, prepared)); }
    catch (error) { const code = error instanceof Error ? error.message : "";
      results.set(sourceSlideNumber, { error: /^[A-Z_]+$/.test(code) ? code : "REDACTED_OUTPUT_NOT_APPROVED" }); }
  }
  return results;
}

export type RedactedUploadPacket = { kind: "verified-redacted-png"; workId: string; buildId: string; sourceSlideNumber: number;
  imageHash: string; ruleVersion: string; redactionFingerprint: string; png: Buffer };
/** No default network transport. Integration must inject one explicitly; tests use a local stub.
 * No source/preview/OCR/exception text/path can enter this whitelisted packet. One call, no retry.
 */
export async function uploadVerifiedRedactedSlide(input: RedactionIdentity,
  transport: (packet: RedactedUploadPacket, signal: AbortSignal) => Promise<{ sha256: string }>, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail("INVALID_UPLOAD_TIMEOUT");
  return locked(input.root, async (store) => {
    const { state, bytes } = await verifiedBytes(store, input);
    const fingerprint = state.output!.inputFingerprint, key = `redacted-upload:${input.sourceSlideNumber}:${fingerprint.slice(0, 24)}`;
    const cached = await store.getReusableArtifact(input.buildId, key);
    if (cached) return { cached: true, imageHash: state.output!.sha256 };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const packet: RedactedUploadPacket = { kind: "verified-redacted-png", workId: state.workId, buildId: state.buildId,
      sourceSlideNumber: state.sourceSlideNumber, imageHash: state.output!.sha256, ruleVersion: state.ruleVersion,
      redactionFingerprint: fingerprint, png: Buffer.from(bytes) };
    let receipt: { sha256: string };
    try {
      receipt = await Promise.race([Promise.resolve().then(() => transport(packet, controller.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("REDACTED_UPLOAD_TIMEOUT")); }, timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    if (receipt?.sha256 !== state.output!.sha256) fail("REDACTED_UPLOAD_HASH_MISMATCH");
    await writeArtifact(store, input, key, "json", JSON.stringify({ imageHash: receipt.sha256, redactionFingerprint: fingerprint }));
    return { cached: false, imageHash: receipt.sha256 };
  });
}
