import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import sharp from "sharp";
import { openPreparationWorkStore, type PreparationWorkStore } from "./work-store.ts";
import type { PptxInspection } from "./pptx-inspection.ts";
import { readVerifiedRedactedSlidesFromStore } from "./redaction-service.ts";
import { redactionHash, assertFlatRedactionPng } from "./redaction-renderer.ts";
import { getRegisteredApprovedMockupSuite, getApprovedMockupSuiteContract, approvedMockupSuiteTemplates } from "../../portfolio/approved-mockup-suites.ts";
import { resolveApprovedMockupSlots } from "../../portfolio/approved-16x9-templates.ts";
import { approvedTemplateFingerprint } from "../../portfolio/approved-mockup-suite-renderer.ts";
import { renderAssignedApprovedBoard, approvedBoardRendererFingerprint, compareApprovedBoardDraftAndFinal } from "../../portfolio/approved-assigned-board-renderer.ts";
import { LOCAL_MOCKUP_VERSION, type MockupIdentity, type MockupReceipt, type MockupBoard, type LocalMockupState, type LocalMockupReview, type MockupCandidate, type MockupImageRecord } from "./mockup-types.ts";
import { productionSnapshotHash } from "./production-snapshot-hash.ts";
import type { LocalMockupSetSnapshot } from "./mockup-handoff-types.ts";
import { padA4SourceSlide } from "../../portfolio/a4-source-fit.ts";
import { readSourceFormatChoice, sourceFormatSelectionInspection, sourceFormatFingerprint, sourceFormatA4Fit } from "./source-format-choice.ts";
import { normalizeThumbnailTitleSpec, validateThumbnailTitleLayout, thumbnailTitleOverlayFingerprint,
  renderThumbnailTitleOverlay, type ThumbnailTitleSpec, type ThumbnailTitleAspectClass,
  type ThumbnailTitleLayout } from "../../portfolio/thumbnail-title-overlay.ts";
import { LOCAL_MOCKUP_TITLE_VERSION, type LocalMockupTitleState, type LocalMockupTitleReview,
  type MockupTitleImage } from "./mockup-title-types.ts";
import { PRODUCTION_MOCKUP_SNAPSHOT_VERSION, type ProductionMockupDescriptor,
  type ProductionMockupSnapshot, type ProductionMockupSnapshotMode,
  type ProductionSnapshotBoardDescriptor, type ProductionSnapshotRedactionReceipt } from "./production-snapshot-types.ts";

function fail(code: string): never { throw new Error(code); }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function titleText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) fail("MOCKUP_WORK_TITLE_REQUIRED");
  return value.trim();
}
function revision(state: LocalMockupState, expected: number) {
  if (!Number.isSafeInteger(expected) || expected !== state.revision) fail("MOCKUP_REVISION_CONFLICT");
}
// Serialize our local UI's parallel image reads. The on-disk owner lock still
// rejects another process/worker. No network operation or retry is involved.
const operations = new Map<string, Promise<unknown>>();
async function locked<T>(input: MockupIdentity, operation: (store: PreparationWorkStore) => Promise<T>): Promise<T> {
  const previous = operations.get(input.root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const store = await openPreparationWorkStore({ root: input.root });
    try { return await operation(store); } finally { await store.release(); }
  });
  operations.set(input.root, next);
  try { return await next; } finally { if (operations.get(input.root) === next) operations.delete(input.root); }
}
async function context(store: PreparationWorkStore, input: MockupIdentity) {
  const work = await store.readWork();
  if (!work || work.currentBuildId !== input.buildId) fail("MOCKUP_BUILD_NOT_CURRENT");
  const build = await store.readBuild(input.buildId);
  const inspected = await store.getReusableStage(input.buildId, "source_inspection");
  const selectionStage = await store.getReusableStage(input.buildId, "slide_selection");
  if (!inspected || !selectionStage || !await store.getReusableStage(input.buildId, "high_resolution_conversion")) fail("MOCKUP_PREPARATION_INCOMPLETE");
  const inspection = inspected.data as unknown as PptxInspection;
  const selection = selectionStage.data as unknown as { selected: number[]; reserves: number[]; cover: number | null; status: string };
  if (inspection.sourceHash !== build.fingerprint.source.sha256 || !Array.isArray(inspection.slides)
    || !Array.isArray(selection.selected) || !Array.isArray(selection.reserves) || selection.status !== "ready_for_local_review") fail("MOCKUP_PREPARATION_INCOMPLETE");
  const sourceFormatChoice = await readSourceFormatChoice(store, input.buildId, inspection);
  const effectiveInspection = sourceFormatSelectionInspection(inspection, sourceFormatChoice);
  const suite = getRegisteredApprovedMockupSuite(effectiveInspection.aspect);
  const contract = getApprovedMockupSuiteContract(effectiveInspection.aspect);
  if (!suite || !contract) fail("MOCKUP_ASPECT_UNSUPPORTED");
  const templates = approvedMockupSuiteTemplates(suite);
  // Custom source fitting requires its own source-bound review receipt. Redaction
  // approval is still independently required for every source image below.
  const a4SourceFit = sourceFormatA4Fit(inspection, sourceFormatChoice);
  return { work, build, inspection, selection, suite, contract, templates, a4SourceFit, sourceFormatChoice };
}
type Context = Awaited<ReturnType<typeof context>>;
type ApprovedSlide = { receipt: MockupReceipt; bytes: Buffer };
async function catalog(store: PreparationWorkStore, input: MockupIdentity, ctx: Context) {
  const available = new Set([...ctx.selection.selected, ...ctx.selection.reserves]);
  const verified = await readVerifiedRedactedSlidesFromStore(store, { ...input, slideNumbers: [...available] });
  const approved = new Map<number, ApprovedSlide>();
  const candidates: MockupCandidate[] = [];
  for (const slide of ctx.inspection.slides) {
    const n = slide.sourceSlideNumber;
    const candidate: MockupCandidate = { sourceSlideNumber: n, title: (slide.title || "").slice(0, 160), status: "needs_preparation" };
    if (available.has(n)) {
      candidate.status = "needs_redaction";
      try {
        const receipt = verified.get(n);
        if (!receipt || "error" in receipt) fail(receipt && "error" in receipt ? receipt.error : "MOCKUP_SLIDE_NOT_APPROVED");
        const { state, bytes } = receipt;
        const output = state.output!;
        const metadata = await sharp(bytes).metadata();
        const sourceFit = ctx.a4SourceFit ? (await padA4SourceSlide({ ...ctx.a4SourceFit, buffer: bytes })).receipt : undefined;
        if (!sourceFit && (!metadata.width || !metadata.height || Math.abs(metadata.width / metadata.height / ctx.suite.thumbnail.slideAspectRatio - 1) > .005)) fail("MOCKUP_SLIDE_ASPECT_MISMATCH");
        approved.set(n, { bytes, receipt: { sourceSlideNumber: n, imageHash: output.sha256,
          redactionFingerprint: output.inputFingerprint, ruleVersion: state.ruleVersion, approvedAt: output.approvedAt!,
          ...(sourceFit ? { sourceFit } : {}) } });
        candidate.status = "approved"; candidate.imageHash = output.sha256;
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        candidate.reason = /^[A-Z_]+$/.test(code) ? code : "MOCKUP_SLIDE_NOT_APPROVED";
      }
    }
    candidates.push(candidate);
  }
  return { approved, candidates };
}
async function artifact(store: PreparationWorkStore, input: MockupIdentity, key: string, extension: string, bytes: string | Buffer) {
  const relativePath = `mockups/${randomUUID()}.${extension}`;
  const destination = await store.prepareArtifactPath(input.buildId, relativePath);
  await writeFile(`${destination}.tmp`, bytes, { flag: "wx", mode: 0o600 });
  await rename(`${destination}.tmp`, destination);
  const build = await store.readBuild(input.buildId);
  await store.recordArtifact({ buildId: input.buildId, key, expectedRevision: build.revision, relativePath });
}
async function persist(store: PreparationWorkStore, input: MockupIdentity, state: LocalMockupState) {
  await artifact(store, input, "mockup-state", "json", JSON.stringify(state));
}
async function load(store: PreparationWorkStore, input: MockupIdentity, ctx: Context): Promise<LocalMockupState | null> {
  const build = await store.readBuild(input.buildId);
  const saved = await store.getReusableArtifact(input.buildId, "mockup-state");
  if (!saved) {
    if (build.artifacts["mockup-state"]) fail("MOCKUP_STATE_CORRUPT");
    return null;
  }
  const bytes = await readFile(saved.absolutePath);
  if (bytes.length > 2 * 1024 * 1024 || redactionHash(bytes) !== saved.record.sha256) fail("MOCKUP_STATE_CORRUPT");
  const state = JSON.parse(bytes.toString("utf8")) as LocalMockupState;
  if (state.version !== LOCAL_MOCKUP_VERSION || state.workId !== ctx.work.workId || state.buildId !== input.buildId
    || state.sourceHash !== ctx.inspection.sourceHash || state.aspectClass !== ctx.suite.aspectClass || state.suiteId !== ctx.suite.suiteId
    || state.templateVersion !== ctx.suite.version || !Number.isSafeInteger(state.revision) || state.revision < 0
    || state.sourceFormatFingerprint !== sourceFormatFingerprint(ctx.sourceFormatChoice)
    || !Array.isArray(state.boards) || state.boards.length !== ctx.templates.length || !Array.isArray(state.requests)) fail("MOCKUP_STATE_STALE");
  titleText(state.title);
  for (const [i, template] of ctx.templates.entries()) {
    const board = state.boards[i], slots = resolveApprovedMockupSlots(template);
    if (board.templateId !== template.id || board.geometryHash !== approvedTemplateFingerprint(template)
      || !Array.isArray(board.slots) || board.slots.length !== slots.length
      || board.slots.some((s, j) => s.slotId !== slots[j].id)) fail("MOCKUP_TEMPLATE_CHANGED");
  }
  return state;
}
function required(state: LocalMockupState | null) { if (!state) fail("MOCKUP_NOT_INITIALIZED"); return state; }
const renderInputHash = (receipt: MockupReceipt) => receipt.sourceFit?.resultHash ?? receipt.imageHash;
function boardHolds(board: MockupBoard, approved: Map<number, ApprovedSlide>) {
  const holds: string[] = [], numbers = new Set<number>(), hashes = new Set<string>(), renderHashes = new Set<string>();
  for (const slot of board.slots) {
    const n = slot.sourceSlideNumber;
    if (n === null) { holds.push(`EMPTY_SLOT:${slot.slotId}`); continue; }
    const candidate = approved.get(n);
    if (!candidate) { holds.push(`SLIDE_NOT_APPROVED:${n}`); continue; }
    if (!equal(slot.receipt, candidate.receipt)) holds.push(`REDACTION_CHANGED:${n}`);
    if (numbers.has(n)) holds.push(`DUPLICATE_SLIDE:${n}`);
    if (hashes.has(candidate.receipt.imageHash) || renderHashes.has(renderInputHash(candidate.receipt))) holds.push(`DUPLICATE_IMAGE:${n}`);
    numbers.add(n); hashes.add(candidate.receipt.imageHash); renderHashes.add(renderInputHash(candidate.receipt));
  }
  return holds;
}
async function boardFingerprint(state: LocalMockupState, board: MockupBoard, ctx: Context) {
  const template = ctx.templates.find((t) => t.id === board.templateId)!;
  return redactionHash(JSON.stringify({ version: LOCAL_MOCKUP_VERSION, workId: state.workId, buildId: state.buildId,
    sourceHash: state.sourceHash, sourceFormatFingerprint: state.sourceFormatFingerprint, suiteId: state.suiteId, templateVersion: state.templateVersion,
    geometry: board.geometryHash, renderer: await approvedBoardRendererFingerprint(state.aspectClass, board.templateId),
    title: template.kind === "thumbnail" ? state.title : null, slots: board.slots }));
}
const renderFingerprint = (fingerprint: string, scale: .5 | 1) => redactionHash(JSON.stringify({ fingerprint, scale, format: "png" }));
async function imageValid(store: PreparationWorkStore, input: MockupIdentity, image: MockupImageRecord | null, fingerprint: string,
  scale: .5 | 1, canvas: { width: number; height: number }) {
  if (!image || image.inputFingerprint !== fingerprint || image.scale !== scale || image.renderFingerprint !== renderFingerprint(fingerprint, scale)
    || image.width !== canvas.width * scale || image.height !== canvas.height * scale) return false;
  for (const [key, hash] of [[image.artifactKey, image.sha256], [image.debugArtifactKey, image.debugHash], [image.manifestArtifactKey, image.manifestHash]]) {
    const a = await store.getReusableArtifact(input.buildId, key);
    if (!a || a.record.sha256 !== hash) return false;
    if (key !== image.manifestArtifactKey) {
      const bytes = await readFile(a.absolutePath);
      if (redactionHash(bytes) !== hash) return false;
      try {
        assertFlatRedactionPng(bytes);
        const metadata = await sharp(bytes).metadata();
        if (metadata.width !== image.width || metadata.height !== image.height) return false;
      } catch { return false; }
    }
  }
  return true;
}
async function review(store: PreparationWorkStore, input: MockupIdentity, ctx: Context, state: LocalMockupState | null,
  cat: Awaited<ReturnType<typeof catalog>>): Promise<LocalMockupReview> {
  const boards = [];
  for (const [i, template] of ctx.templates.entries()) {
    const specSlots = resolveApprovedMockupSlots(template), board = state?.boards[i];
    const holds = board ? boardHolds(board, cat.approved) : ["MOCKUP_NOT_INITIALIZED"];
    const fingerprint = board && state ? await boardFingerprint(state, board, ctx) : "";
    boards.push({ templateId: template.id, label: i === 0 ? "썸네일" : `BODY ${i}`,
      slots: specSlots.map((s, j) => ({ slotId: s.id, position: j + 1, role: s.role, sourceSlideNumber: board?.slots[j].sourceSlideNumber ?? null })), holds,
      draft: board && !holds.length && await imageValid(store, input, board.draft, fingerprint, .5, template.canvas) ? board.draft : null,
      final: board && !holds.length && await imageValid(store, input, board.final, fingerprint, 1, template.canvas) ? board.final : null });
  }
  return { workId: ctx.work.workId, buildId: input.buildId, aspectClass: ctx.suite.aspectClass, minimum: ctx.contract.minimumUniqueSlideCount,
    ...(ctx.a4SourceFit ? { sourceFitNotice: ctx.sourceFormatChoice
      ? "직접 선택한 사용자 지정 세로 원본입니다. 원본 비율을 유지하고 흰 여백만 보충하여 A4 세로 템플릿에 배치합니다. 규격 선택은 가림 승인이나 발행 승인이 아닙니다."
      : "PowerPoint A4 원본 비율을 유지하고 위·아래 흰 여백을 보충합니다. 장표를 늘이거나 자르지 않으며 템플릿 정렬은 그대로입니다." } : {}),
    revision: state?.revision ?? null, title: state?.title ?? "", state: state ? { initialized: true } : null, candidates: cat.candidates, boards,
    requests: (state?.requests ?? []).map((r) => ({ ...r, status: cat.approved.has(r.sourceSlideNumber) ? "ready" : "pending" })),
    visualReview: "not_performed", activeSetUnchanged: true };
}
export async function getLocalMockupReview(input: MockupIdentity) {
  return locked(input, async (store) => { const ctx = await context(store, input);
    return review(store, input, ctx, await load(store, input, ctx), await catalog(store, input, ctx)); });
}
export async function initializeLocalMockups(input: MockupIdentity & { title: string }) {
  return locked(input, async (store) => {
    const title = titleText(input.title), ctx = await context(store, input), cat = await catalog(store, input, ctx);
    const existing = await load(store, input, ctx);
    if (existing) return review(store, input, ctx, existing, cat);
    const usage = new Map([...cat.approved.keys()].map((n) => [n, 0]));
    const state: LocalMockupState = { version: LOCAL_MOCKUP_VERSION, workId: ctx.work.workId, buildId: input.buildId,
      sourceHash: ctx.inspection.sourceHash, aspectClass: ctx.suite.aspectClass, suiteId: ctx.suite.suiteId,
      ...(ctx.sourceFormatChoice ? { sourceFormatFingerprint: sourceFormatFingerprint(ctx.sourceFormatChoice) } : {}),
      templateVersion: ctx.suite.version, revision: 0, title, requests: [], boards: [] };
    for (const template of ctx.templates) {
      const used = new Set<string>(), usedRender = new Set<string>();
      const slots = resolveApprovedMockupSlots(template).map((slot, position) => {
        const candidates = [...cat.approved].filter(([, s]) => !used.has(s.receipt.imageHash) && !usedRender.has(renderInputHash(s.receipt)));
        candidates.sort((a, b) => (usage.get(a[0])! - usage.get(b[0])!) || a[0] - b[0]);
        // A missing/unapproved designated cover is not permission to substitute
        // another slide. Leave its slot open until the user explicitly assigns it.
        const selected = template.kind === "thumbnail" && position === 0
          ? candidates.find(([n]) => n === ctx.selection.cover) : candidates[0];
        if (selected) { used.add(selected[1].receipt.imageHash); usedRender.add(renderInputHash(selected[1].receipt)); usage.set(selected[0], usage.get(selected[0])! + 1); }
        return { slotId: slot.id, sourceSlideNumber: selected?.[0] ?? null, receipt: selected?.[1].receipt ?? null };
      });
      state.boards.push({ templateId: template.id, geometryHash: approvedTemplateFingerprint(template), slots, draft: null, final: null });
    }
    await persist(store, input, state);
    return review(store, input, ctx, state, cat);
  });
}
export async function saveLocalMockupAssignments(input: MockupIdentity & { expectedRevision: number; title: string;
  boards: { templateId: string; slots: { slotId: string; sourceSlideNumber: number | null }[] }[] }) {
  return locked(input, async (store) => {
    const ctx = await context(store, input), state = required(await load(store, input, ctx)); revision(state, input.expectedRevision);
    const title = titleText(input.title), cat = await catalog(store, input, ctx);
    if (!Array.isArray(input.boards) || input.boards.length !== state.boards.length) fail("MOCKUP_INVALID_ASSIGNMENT");
    const numbers = new Set(ctx.inspection.slides.map((s) => s.sourceSlideNumber));
    let changed = title !== state.title;
    for (const [i, old] of state.boards.entries()) {
      const board = input.boards[i];
      if (!board || board.templateId !== old.templateId || !Array.isArray(board.slots) || board.slots.length !== old.slots.length) fail("MOCKUP_INVALID_ASSIGNMENT");
      const slots = board.slots.map((s, j) => {
        if (!s || s.slotId !== old.slots[j].slotId || (s.sourceSlideNumber !== null && (!Number.isSafeInteger(s.sourceSlideNumber) || !numbers.has(s.sourceSlideNumber)))) fail("MOCKUP_INVALID_ASSIGNMENT");
        return { slotId: s.slotId, sourceSlideNumber: s.sourceSlideNumber, receipt: s.sourceSlideNumber === null ? null : cat.approved.get(s.sourceSlideNumber)?.receipt ?? null };
      });
      // Store even incomplete choices, but never render them. This lets the UI
      // explain duplicates or a pending replacement without inventing fillers.
      if (!equal(slots, old.slots) || (i === 0 && title !== state.title)) {
        old.slots = slots; old.draft = null; old.final = null; changed = true;
      }
    }
    if (changed) { state.title = title; state.revision++; await persist(store, input, state); }
    return review(store, input, ctx, state, cat);
  });
}
export async function requestLocalMockupSlide(input: MockupIdentity & { expectedRevision: number; sourceSlideNumber: number; reason: string }) {
  return locked(input, async (store) => {
    const ctx = await context(store, input), state = required(await load(store, input, ctx)); revision(state, input.expectedRevision);
    if (!Number.isSafeInteger(input.sourceSlideNumber) || !ctx.inspection.slides.some((s) => s.sourceSlideNumber === input.sourceSlideNumber)
      || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500 || /[\x00-\x1f]/.test(input.reason)) fail("MOCKUP_INVALID_PREPARATION_REQUEST");
    const cat = await catalog(store, input, ctx);
    if (!cat.approved.has(input.sourceSlideNumber) && !state.requests.some((r) => r.sourceSlideNumber === input.sourceSlideNumber)) {
      if (state.requests.length >= 500) fail("MOCKUP_REQUEST_LIMIT");
      state.requests.push({ id: randomUUID(), sourceSlideNumber: input.sourceSlideNumber, reason: input.reason.trim(), createdAt: new Date().toISOString() });
      state.revision++; await persist(store, input, state);
    }
    return review(store, input, ctx, state, cat);
  });
}
export async function renderLocalMockups(input: MockupIdentity & { expectedRevision: number; scale: .5 | 1; templateIds?: string[] }) {
  return locked(input, async (store) => {
    const ctx = await context(store, input), state = required(await load(store, input, ctx)); revision(state, input.expectedRevision);
    if (input.scale !== .5 && input.scale !== 1) fail("MOCKUP_INVALID_SCALE");
    const ids = input.templateIds ?? state.boards.map((b) => b.templateId);
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some((id) => !state.boards.some((b) => b.templateId === id))) fail("MOCKUP_INVALID_TEMPLATE");
    const cat = await catalog(store, input, ctx);
    for (const board of state.boards.filter((b) => ids.includes(b.templateId))) {
      const holds = boardHolds(board, cat.approved);
      if (holds.length) fail(`MOCKUP_ASSIGNMENT_HELD:${board.templateId}:${holds.join(",")}`);
    }
    for (const board of state.boards.filter((b) => ids.includes(b.templateId))) {
      const fingerprint = await boardFingerprint(state, board, ctx), mode = input.scale === .5 ? "draft" : "final";
      const template = ctx.templates.find((t) => t.id === board.templateId)!;
      if (await imageValid(store, input, board[mode], fingerprint, input.scale, template.canvas)) continue;
      if (input.scale === 1 && !await imageValid(store, input, board.draft, fingerprint, .5, template.canvas)) fail("MOCKUP_DRAFT_REQUIRED");
      const result = await renderAssignedApprovedBoard({ aspectClass: state.aspectClass, templateId: board.templateId,
        slides: board.slots.map((s) => ({ index: s.sourceSlideNumber! - 1, buffer: cat.approved.get(s.sourceSlideNumber!)!.bytes })), title: state.title, scale: input.scale,
        a4SourceFit: ctx.a4SourceFit });
      if (result.manifest.slots.some((s, i) => !equal(s.sourceFit, board.slots[i].receipt?.sourceFit))) fail("MOCKUP_SOURCE_FIT_CHANGED");
      if (input.scale === 1) {
        const draftArtifact = await store.getReusableArtifact(input.buildId, board.draft!.manifestArtifactKey);
        if (!draftArtifact) fail("MOCKUP_DRAFT_REQUIRED");
        const draftBytes = await readFile(draftArtifact.absolutePath);
        if (redactionHash(draftBytes) !== board.draft!.manifestHash) fail("MOCKUP_DRAFT_CHANGED");
        const draft = JSON.parse(draftBytes.toString("utf8"));
        if (draft.inputFingerprint !== fingerprint || !equal(draft.slots, board.slots)
          || !compareApprovedBoardDraftAndFinal(draft.render, result.manifest).passed) fail("MOCKUP_DRAFT_FINAL_GEOMETRY_MISMATCH");
      }
      assertFlatRedactionPng(result.bytes); assertFlatRedactionPng(result.debugBytes);
      const metadata = await sharp(result.bytes).metadata();
      if (metadata.width !== template.canvas.width * input.scale || metadata.height !== template.canvas.height * input.scale) fail("MOCKUP_OUTPUT_SIZE_MISMATCH");
      const prefix = `mockup:${randomUUID()}`, manifest = JSON.stringify({ workId: state.workId, buildId: state.buildId,
        inputFingerprint: fingerprint, slots: board.slots, render: result.manifest });
      await artifact(store, input, `${prefix}:image`, "png", result.bytes);
      await artifact(store, input, `${prefix}:debug`, "png", result.debugBytes);
      await artifact(store, input, `${prefix}:manifest`, "json", manifest);
      board[mode] = { artifactKey: `${prefix}:image`, sha256: redactionHash(result.bytes), debugArtifactKey: `${prefix}:debug`, debugHash: redactionHash(result.debugBytes),
        manifestArtifactKey: `${prefix}:manifest`, manifestHash: redactionHash(manifest), width: result.width, height: result.height,
        inputFingerprint: fingerprint, renderFingerprint: renderFingerprint(fingerprint, input.scale), scale: input.scale, createdAt: new Date().toISOString() };
      // Each completed board is a checkpoint. A later failure leaves it reusable;
      // there is no automatic retry and no activation/publication here.
      state.revision++; await persist(store, input, state);
    }
    return review(store, input, ctx, state, cat);
  });
}
export async function readLocalMockupImage(input: MockupIdentity & { templateId: string; scale: .5 | 1; debug?: boolean }) {
  return locked(input, async (store) => {
    const ctx = await context(store, input), state = required(await load(store, input, ctx));
    if (input.scale !== .5 && input.scale !== 1) fail("MOCKUP_INVALID_SCALE");
    const board = state.boards.find((b) => b.templateId === input.templateId);
    if (!board) fail("MOCKUP_INVALID_TEMPLATE");
    const cat = await catalog(store, input, ctx);
    if (boardHolds(board, cat.approved).length) fail("MOCKUP_ASSIGNMENT_STALE");
    const image = input.scale === .5 ? board.draft : board.final;
    const template = ctx.templates.find((t) => t.id === board.templateId)!;
    if (!image || !await imageValid(store, input, image, await boardFingerprint(state, board, ctx), input.scale, template.canvas)) fail("MOCKUP_IMAGE_NOT_CURRENT");
    const a = await store.getReusableArtifact(input.buildId, input.debug ? image.debugArtifactKey : image.artifactKey);
    if (!a) fail("MOCKUP_IMAGE_NOT_CURRENT");
    const bytes = await readFile(a.absolutePath);
    if (redactionHash(bytes) !== (input.debug ? image.debugHash : image.sha256)) fail("MOCKUP_IMAGE_NOT_CURRENT");
    assertFlatRedactionPng(bytes);
    return bytes;
  });
}

/** Trusted integration seam, not an HTTP endpoint. The callback receives only
 * current final PNGs and whitelisted identity/numbering, never raw source,
 * preview/debug images, source paths, slide text or privacy exceptions. Keep
 * the store locked through the callback so approval/assignment cannot change
 * between upload verification and an explicitly authorized atomic switch. */
export async function withVerifiedLocalMockupSet<T>(input: MockupIdentity,
  operation: (snapshot: LocalMockupSetSnapshot) => Promise<T>): Promise<T> {
  return locked(input, async store => {
    // Title editing is deliberately not wired to production handoff. Even an
    // incomplete/corrupt sidecar must not silently publish the legacy title.
    if ((await store.readBuild(input.buildId)).artifacts["mockup-title-edit-state"]) fail("MOCKUP_TITLE_EDIT_LOCAL_ONLY");
    const ctx = await context(store, input), state = required(await load(store, input, ctx));
    const cat = await catalog(store, input, ctx);
    const boards: LocalMockupSetSnapshot["boards"] = [];
    const bindings = [];
    for (const [i, board] of state.boards.entries()) {
      const template = ctx.templates[i], fingerprint = await boardFingerprint(state, board, ctx);
      if (boardHolds(board, cat.approved).length) fail("MOCKUP_HANDOFF_REDACTION_STALE");
      if (!board.final || !await imageValid(store, input, board.final, fingerprint, 1, template.canvas)
        || !await imageValid(store, input, board.draft, fingerprint, .5, template.canvas)) fail("MOCKUP_HANDOFF_INCOMPLETE");
      const file = await store.getReusableArtifact(input.buildId, board.final.artifactKey);
      if (!file) fail("MOCKUP_HANDOFF_INCOMPLETE");
      const png = await readFile(file.absolutePath);
      if (redactionHash(png) !== board.final.sha256) fail("MOCKUP_IMAGE_NOT_CURRENT");
      assertFlatRedactionPng(png);
      boards.push({ templateId: board.templateId, templateVersion: template.version,
        kind: i === 0 ? "thumbnail" : "body_image", imageHash: board.final.sha256,
        width: board.final.width, height: board.final.height, slideAspectRatio: template.slideAspectRatio,
        sourceSlideNumbers: board.slots.map(slot => slot.sourceSlideNumber!), png });
      bindings.push({ templateId: board.templateId, fingerprint, imageHash: board.final.sha256 });
    }
    return operation({ localWorkId: state.workId, buildId: state.buildId, sourceHash: state.sourceHash,
      aspectClass: state.aspectClass, suiteId: state.suiteId, templateVersion: state.templateVersion,
      assignmentHash: redactionHash(JSON.stringify(bindings)), boards });
  });
}

// Thumbnail title editing is a separate, local-only transaction. Never persist
// the legacy mockup state, alter assignments, or activate a portfolio image set.
const TITLE_STATE_KEY = "mockup-title-edit-state";
const titleSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function exactTitleKeys(value: unknown, keys: string[]) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && equal(Object.keys(value).sort(), [...keys].sort()));
}
function titleSpec(value: unknown) {
  try { return normalizeThumbnailTitleSpec(value); } catch { fail("MOCKUP_TITLE_STATE_CORRUPT"); }
}
function validTitleImageShape(value: MockupTitleImage | null) {
  if (value === null) return true;
  const keys = ["sha256","artifactKey","debugArtifactKey","debugHash","manifestArtifactKey","manifestHash",
    "inputFingerprint","renderFingerprint","scale","width","height","createdAt","baseFingerprint","overlayFingerprint"];
  return exactTitleKeys(value, keys)
    && [value.sha256,value.debugHash,value.manifestHash,value.inputFingerprint,value.renderFingerprint,value.baseFingerprint,value.overlayFingerprint].every(titleSha)
    && [value.artifactKey,value.debugArtifactKey,value.manifestArtifactKey].every(key => typeof key === "string" && /^mockup-title:[a-f0-9-]{36}:(image|manifest)$/.test(key))
    && value.debugArtifactKey === value.artifactKey && value.debugHash === value.sha256
    && (value.scale === .5 || value.scale === 1) && value.width === 1080 * value.scale && value.height === 1080 * value.scale
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}
async function loadTitleState(store: PreparationWorkStore, input: MockupIdentity, ctx: Context) {
  const build = await store.readBuild(input.buildId), saved = await store.getReusableArtifact(input.buildId, TITLE_STATE_KEY);
  if (!saved) { if (build.artifacts[TITLE_STATE_KEY]) fail("MOCKUP_TITLE_STATE_CORRUPT"); return null; }
  const bytes = await readFile(saved.absolutePath);
  if (bytes.length > 128 * 1024 || redactionHash(bytes) !== saved.record.sha256) fail("MOCKUP_TITLE_STATE_CORRUPT");
  let state: LocalMockupTitleState;
  try { state = JSON.parse(bytes.toString("utf8")); } catch { fail("MOCKUP_TITLE_STATE_CORRUPT"); }
  if (!exactTitleKeys(state, ["version","workId","buildId","sourceHash","revision","baseFingerprint","title","draft","final","active","activeTitle"])
    || state.version !== LOCAL_MOCKUP_TITLE_VERSION || state.workId !== ctx.work.workId || state.buildId !== input.buildId
    || state.sourceHash !== ctx.inspection.sourceHash || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !titleSha(state.baseFingerprint) || ![state.draft,state.final,state.active].every(validTitleImageShape)
    || (state.active === null) !== (state.activeTitle === null)) fail("MOCKUP_TITLE_STATE_CORRUPT");
  if (!equal(titleSpec(state.title), state.title) || (state.activeTitle && !equal(titleSpec(state.activeTitle), state.activeTitle))) fail("MOCKUP_TITLE_STATE_CORRUPT");
  if ((state.draft && state.draft.scale !== .5) || (state.final && state.final.scale !== 1) || (state.active && state.active.scale !== 1)) fail("MOCKUP_TITLE_STATE_CORRUPT");
  return state;
}
async function titleContext(store: PreparationWorkStore, input: MockupIdentity) {
  const ctx = await context(store, input), legacy = await load(store, input, ctx), cat = await catalog(store, input, ctx);
  const board = legacy?.boards.find(b => ctx.templates.find(t => t.id === b.templateId)?.kind === "thumbnail") ?? null;
  const baseFingerprint = board && legacy ? await boardFingerprint(legacy, board, ctx) : null;
  const holds = board ? boardHolds(board, cat.approved) : ["MOCKUP_NOT_INITIALIZED"];
  const state = await loadTitleState(store, input, ctx);
  return { ctx, legacy, cat, board, baseFingerprint, holds, state };
}
type TitleContext = Awaited<ReturnType<typeof titleContext>>;
function titleInputFingerprint(baseFingerprint: string, overlayFingerprint: string, title: ThumbnailTitleSpec) {
  return redactionHash(JSON.stringify({ version: LOCAL_MOCKUP_TITLE_VERSION, baseFingerprint, overlayFingerprint, title }));
}
function titleRevision(state: LocalMockupTitleState | null, expected: number | null) {
  if (state ? !Number.isSafeInteger(expected) || state.revision !== expected : expected !== null) fail("MOCKUP_TITLE_REVISION_CONFLICT");
}
function titleBase(current: TitleContext, expected: string) {
  if (!titleSha(expected) || !current.baseFingerprint || expected !== current.baseFingerprint) fail("MOCKUP_TITLE_BASE_CHANGED");
  if (!current.legacy || !current.board || current.holds.length) fail("MOCKUP_TITLE_BASE_CHANGED");
}
function titleLayoutProof(layout: ThumbnailTitleLayout): ThumbnailTitleLayout {
  return { schemaVersion: layout.schemaVersion, version: layout.version, aspectClass: layout.aspectClass, style: layout.style,
    baseCanvas: layout.baseCanvas, titleRegion: layout.titleRegion, main: layout.main, sub: layout.sub };
}
async function currentTitleImage(store: PreparationWorkStore, input: MockupIdentity, current: TitleContext,
  image: MockupTitleImage | null, title: ThumbnailTitleSpec | null, scale: .5 | 1, overlay: string) {
  if (!image || !title || current.holds.length || image.baseFingerprint !== current.baseFingerprint || image.overlayFingerprint !== overlay) return false;
  const fingerprint = titleInputFingerprint(image.baseFingerprint, overlay, title);
  return imageValid(store, input, image, fingerprint, scale, { width: 1080, height: 1080 });
}
async function titleReview(store: PreparationWorkStore, input: MockupIdentity, current: TitleContext): Promise<LocalMockupTitleReview> {
  const { legacy, state, board, baseFingerprint } = current, overlay = await thumbnailTitleOverlayFingerprint();
  const stale = Boolean(state && (state.baseFingerprint !== baseFingerprint || current.holds.length));
  const draft = state && !stale && await currentTitleImage(store, input, current, state.draft, state.title, .5, overlay) ? state.draft : null;
  const final = state && !stale && await currentTitleImage(store, input, current, state.final, state.title, 1, overlay) ? state.final : null;
  const active = state && await currentTitleImage(store, input, current, state.active, state.activeTitle, 1, overlay) ? state.active : null;
  const legacyFinalAvailable = Boolean(legacy && board && baseFingerprint && !current.holds.length
    && await imageValid(store, input, board.final, baseFingerprint, 1, { width: 1080, height: 1080 }));
  return { available: Boolean(legacy && board), revision: state?.revision ?? null, baseFingerprint, legacyTitle: legacy?.title ?? "",
    title: state?.title ?? { main: "", sub: "", showSub: false, style: "bold" }, stale,
    holds: [...current.holds, ...(stale ? ["MOCKUP_TITLE_BASE_CHANGED"] : [])], draft, final, active,
    activeTitle: active ? state!.activeTitle : null, legacyFinalAvailable, localOnly: true };
}
export async function getLocalMockupTitleReview(input: MockupIdentity) {
  return locked(input, async store => titleReview(store, input, await titleContext(store, input)));
}
export async function saveLocalMockupTitle(input: MockupIdentity & {
  expectedRevision: number | null; expectedBaseFingerprint: string; title: unknown;
}) {
  return locked(input, async store => {
    const current = await titleContext(store, input); titleRevision(current.state, input.expectedRevision); titleBase(current, input.expectedBaseFingerprint);
    const title = normalizeThumbnailTitleSpec(input.title);
    await validateThumbnailTitleLayout(title, current.ctx.suite.aspectClass as ThumbnailTitleAspectClass);
    if (current.state && equal(current.state.title, title) && current.state.baseFingerprint === current.baseFingerprint) return titleReview(store, input, current);
    const state: LocalMockupTitleState = current.state ? { ...current.state, revision: current.state.revision + 1,
      title, baseFingerprint: current.baseFingerprint!, draft: null, final: null } : {
      version: LOCAL_MOCKUP_TITLE_VERSION, workId: current.ctx.work.workId, buildId: input.buildId,
      sourceHash: current.ctx.inspection.sourceHash, revision: 0, baseFingerprint: current.baseFingerprint!, title,
      draft: null, final: null, active: null, activeTitle: null };
    const response = await titleReview(store, input, { ...current, state });
    await artifact(store, input, TITLE_STATE_KEY, "json", JSON.stringify(state));
    return response;
  });
}
export async function renderLocalMockupTitle(input: MockupIdentity & {
  expectedRevision: number; expectedBaseFingerprint: string; scale: .5 | 1;
}) {
  return locked(input, async store => {
    const current = await titleContext(store, input); titleRevision(current.state, input.expectedRevision); titleBase(current, input.expectedBaseFingerprint);
    if (!current.state || current.state.baseFingerprint !== current.baseFingerprint) fail("MOCKUP_TITLE_BASE_CHANGED");
    if (input.scale !== .5 && input.scale !== 1) fail("MOCKUP_TITLE_INVALID_SCALE");
    const state = current.state, overlay = await thumbnailTitleOverlayFingerprint(), mode = input.scale === .5 ? "draft" : "final";
    const fingerprint = titleInputFingerprint(state.baseFingerprint, overlay, state.title);
    if (await currentTitleImage(store, input, current, state[mode], state.title, input.scale, overlay)) return titleReview(store, input, current);
    if (input.scale === 1 && !await currentTitleImage(store, input, current, state.draft, state.title, .5, overlay)) fail("MOCKUP_TITLE_DRAFT_REQUIRED");
    const layout = await validateThumbnailTitleLayout(state.title, current.ctx.suite.aspectClass as ThumbnailTitleAspectClass);
    const base = await renderAssignedApprovedBoard({ aspectClass: current.ctx.suite.aspectClass, templateId: current.board!.templateId,
      slides: current.board!.slots.map(slot => ({ index: slot.sourceSlideNumber! - 1, buffer: current.cat.approved.get(slot.sourceSlideNumber!)!.bytes })),
      title: null, scale: input.scale, a4SourceFit: current.ctx.a4SourceFit });
    if (base.manifest.slots.some((slot, i) => !equal(slot.sourceFit, current.board!.slots[i].receipt?.sourceFit))) fail("MOCKUP_SOURCE_FIT_CHANGED");
    const result = await renderThumbnailTitleOverlay({ basePng: base.bytes, title: state.title,
      aspectClass: current.ctx.suite.aspectClass as ThumbnailTitleAspectClass, scale: input.scale });
    if (!equal(titleLayoutProof(result.layout), layout) || result.layout.outsideTitlePixelChanges !== 0
      || overlay !== await thumbnailTitleOverlayFingerprint()) fail("MOCKUP_TITLE_RENDER_CHANGED");
    if (input.scale === 1) {
      const draftArtifact = await store.getReusableArtifact(input.buildId, state.draft!.manifestArtifactKey);
      if (!draftArtifact) fail("MOCKUP_TITLE_DRAFT_REQUIRED");
      const bytes = await readFile(draftArtifact.absolutePath);
      if (redactionHash(bytes) !== state.draft!.manifestHash) fail("MOCKUP_TITLE_DRAFT_CHANGED");
      const draft = JSON.parse(bytes.toString("utf8"));
      if (draft.inputFingerprint !== fingerprint || !equal(draft.layout, layout)
        || !compareApprovedBoardDraftAndFinal(draft.baseRender, base.manifest).passed) fail("MOCKUP_TITLE_DRAFT_FINAL_MISMATCH");
    }
    assertFlatRedactionPng(result.bytes);
    const metadata = await sharp(result.bytes).metadata();
    if (metadata.width !== 1080 * input.scale || metadata.height !== 1080 * input.scale) fail("MOCKUP_TITLE_OUTPUT_SIZE_MISMATCH");
    const prefix = `mockup-title:${randomUUID()}`, sha256 = redactionHash(result.bytes);
    const manifest = JSON.stringify({ version: LOCAL_MOCKUP_TITLE_VERSION, inputFingerprint: fingerprint,
      baseFingerprint: state.baseFingerprint, overlayFingerprint: overlay, title: state.title, layout, baseRender: base.manifest });
    await artifact(store, input, `${prefix}:image`, "png", result.bytes);
    await artifact(store, input, `${prefix}:manifest`, "json", manifest);
    const image: MockupTitleImage = { artifactKey: `${prefix}:image`, sha256, debugArtifactKey: `${prefix}:image`, debugHash: sha256,
      manifestArtifactKey: `${prefix}:manifest`, manifestHash: redactionHash(manifest), inputFingerprint: fingerprint,
      renderFingerprint: renderFingerprint(fingerprint, input.scale), scale: input.scale, width: metadata.width, height: metadata.height,
      baseFingerprint: state.baseFingerprint, overlayFingerprint: overlay, createdAt: new Date().toISOString() };
    const next = { ...state, [mode]: image, revision: state.revision + 1 };
    // A failed image/manifest/state write leaves the last-good active pointer in
    // the previous immutable sidecar. Staged artifacts are never auto-published.
    const response = await titleReview(store, input, { ...current, state: next });
    await artifact(store, input, TITLE_STATE_KEY, "json", JSON.stringify(next));
    return response;
  });
}
export async function confirmLocalMockupTitle(input: MockupIdentity & {
  expectedRevision: number; expectedBaseFingerprint: string; expectedFinalHash: string; visualConfirmed: true;
}) {
  return locked(input, async store => {
    const current = await titleContext(store, input); titleRevision(current.state, input.expectedRevision); titleBase(current, input.expectedBaseFingerprint);
    const state = current.state, overlay = await thumbnailTitleOverlayFingerprint();
    if (!state || state.baseFingerprint !== current.baseFingerprint) fail("MOCKUP_TITLE_BASE_CHANGED");
    if (input.visualConfirmed !== true || !titleSha(input.expectedFinalHash) || state.final?.sha256 !== input.expectedFinalHash) fail("MOCKUP_TITLE_CONFIRMATION_REQUIRED");
    if (!await currentTitleImage(store, input, current, state.draft, state.title, .5, overlay)
      || !await currentTitleImage(store, input, current, state.final, state.title, 1, overlay)) fail("MOCKUP_TITLE_FINAL_REQUIRED");
    if (equal(state.active, state.final) && equal(state.activeTitle, state.title)) return titleReview(store, input, current);
    const next = { ...state, active: state.final, activeTitle: state.title, revision: state.revision + 1 };
    const response = await titleReview(store, input, { ...current, state: next });
    await artifact(store, input, TITLE_STATE_KEY, "json", JSON.stringify(next));
    return response;
  });
}
export async function readLocalMockupTitleImage(input: MockupIdentity & {
  kind: "draft" | "final" | "active"; expectedHash: string;
}) {
  return locked(input, async store => {
    if (!["draft","final","active"].includes(input.kind) || !titleSha(input.expectedHash)) fail("MOCKUP_TITLE_IMAGE_NOT_CURRENT");
    const current = await titleContext(store, input), review = await titleReview(store, input, current), image = review[input.kind];
    if (!image || image.sha256 !== input.expectedHash) fail("MOCKUP_TITLE_IMAGE_NOT_CURRENT");
    const saved = await store.getReusableArtifact(input.buildId, image.artifactKey);
    if (!saved) fail("MOCKUP_TITLE_IMAGE_NOT_CURRENT");
    const bytes = await readFile(saved.absolutePath);
    if (redactionHash(bytes) !== input.expectedHash) fail("MOCKUP_TITLE_IMAGE_NOT_CURRENT");
    assertFlatRedactionPng(bytes);
    return bytes;
  });
}

// Separate opt-in transport seam. Legacy withVerifiedLocalMockupSet remains
// guarded above; this function grants neither remote approval nor activation.
function productionSnapshotMode(value: unknown): asserts value is ProductionMockupSnapshotMode {
  if (value !== "full" && value !== "thumbnail") fail("PRODUCTION_SNAPSHOT_MODE_INVALID");
}
function productionRedactionReceipt(slotId: string, receipt: MockupReceipt): ProductionSnapshotRedactionReceipt {
  const fit = receipt.sourceFit;
  return { slotId, sourceSlideNumber: receipt.sourceSlideNumber, imageHash: receipt.imageHash,
    redactionFingerprint: receipt.redactionFingerprint, ruleVersion: receipt.ruleVersion,
    approvedAt: receipt.approvedAt,
    ...(fit ? { sourceFit: { version: fit.version, sourceKind: fit.sourceKind,
      sourceHash: fit.sourceHash, resultHash: fit.resultHash, sourceWidth: fit.sourceWidth,
      sourceHeight: fit.sourceHeight, sourcePixelWidth: fit.sourcePixelWidth,
      sourcePixelHeight: fit.sourcePixelHeight, targetWidth: fit.targetWidth,
      targetHeight: fit.targetHeight, padding: { top: fit.padding.top, right: fit.padding.right,
        bottom: fit.padding.bottom, left: fit.padding.left }, scale: fit.scale,
      crop: fit.crop, targetAspectClass: fit.targetAspectClass } } : {}) };
}
async function productionSnapshotImage(store: PreparationWorkStore, input: MockupIdentity, image: MockupImageRecord) {
  const file = await store.getReusableArtifact(input.buildId, image.artifactKey);
  if (!file || file.record.sha256 !== image.sha256) fail("PRODUCTION_SNAPSHOT_IMAGE_STALE");
  const bytes = await readFile(file.absolutePath);
  if (redactionHash(bytes) !== image.sha256) fail("PRODUCTION_SNAPSHOT_IMAGE_STALE");
  assertFlatRedactionPng(bytes);
  return bytes;
}
async function productionTitleManifest(store: PreparationWorkStore, input: MockupIdentity, image: MockupTitleImage) {
  const file = await store.getReusableArtifact(input.buildId, image.manifestArtifactKey);
  if (!file || file.record.sha256 !== image.manifestHash) fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
  const bytes = await readFile(file.absolutePath);
  if (bytes.length > 2 * 1024 * 1024 || redactionHash(bytes) !== image.manifestHash) fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
  try { return JSON.parse(bytes.toString("utf8")); } catch { return fail("PRODUCTION_SNAPSHOT_TITLE_STALE"); }
}
async function createVerifiedProductionSnapshot(store: PreparationWorkStore, input: MockupIdentity,
  mode: ProductionMockupSnapshotMode): Promise<ProductionMockupSnapshot> {
  const current = await titleContext(store, input), { ctx, cat, state: titleState } = current;
  const state = required(current.legacy);
  if (!current.board || !current.baseFingerprint || current.holds.length) fail("PRODUCTION_SNAPSHOT_REDACTION_STALE");
  if (mode === "thumbnail" && !titleState) fail("PRODUCTION_SNAPSHOT_TITLE_CONFIRMATION_REQUIRED");
  const overlay = titleState ? await thumbnailTitleOverlayFingerprint() : null;
  if (titleState) {
    // An edited-but-unconfirmed title must not silently export a last-good title.
    if (!titleState.active || !titleState.activeTitle || !equal(titleState.activeTitle, titleState.title)
      || !equal(titleState.active, titleState.final)) fail("PRODUCTION_SNAPSHOT_TITLE_CONFIRMATION_REQUIRED");
    if (titleState.baseFingerprint !== current.baseFingerprint
      || !await currentTitleImage(store, input, current, titleState.active, titleState.activeTitle, 1, overlay!)
      || !await currentTitleImage(store, input, current, titleState.draft, titleState.title, .5, overlay!)) {
      fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
    }
  }
  // Every assignment is bound, but thumbnail-only export neither requires nor
  // regenerates any BODY render. Existing BODY images are not a transport target.
  const assignmentBindings = await Promise.all(state.boards.map(async board => ({
    templateId: board.templateId, fingerprint: await boardFingerprint(state, board, ctx),
  })));
  const boards: (ProductionSnapshotBoardDescriptor & { png: Buffer })[] = [];
  const targetBoards = mode === "thumbnail" ? [current.board] : state.boards;
  for (const board of targetBoards) {
    const template = ctx.templates.find(candidate => candidate.id === board.templateId)!;
    const fingerprint = assignmentBindings.find(binding => binding.templateId === board.templateId)!.fingerprint;
    if (boardHolds(board, cat.approved).length) fail("PRODUCTION_SNAPSHOT_REDACTION_STALE");
    const useTitle = template.kind === "thumbnail" && titleState;
    const image = useTitle ? titleState.active! : board.final;
    if (!useTitle && (!image || !await imageValid(store, input, image, fingerprint, 1, template.canvas)
      || !await imageValid(store, input, board.draft, fingerprint, .5, template.canvas))) {
      fail("PRODUCTION_SNAPSHOT_INCOMPLETE");
    }
    if (!image) fail("PRODUCTION_SNAPSHOT_INCOMPLETE");
    const png = await productionSnapshotImage(store, input, image);
    boards.push({ templateId: board.templateId, templateVersion: template.version,
      kind: template.kind === "thumbnail" ? "thumbnail" : "body_image", imageHash: image.sha256,
      width: image.width, height: image.height, slideAspectRatio: template.slideAspectRatio,
      sourceSlideNumbers: board.slots.map(slot => slot.sourceSlideNumber!), geometryHash: board.geometryHash,
      rendererFingerprint: await approvedBoardRendererFingerprint(state.aspectClass, board.templateId),
      assignmentFingerprint: fingerprint,
      redactions: board.slots.map(slot => productionRedactionReceipt(slot.slotId, cat.approved.get(slot.sourceSlideNumber!)!.receipt)), png });
  }
  // Only the thumbnail base is reconstructed, exclusively from current approved
  // redactions. Nothing is persisted, and no BODY renderer is invoked.
  const base = await renderAssignedApprovedBoard({ aspectClass: ctx.suite.aspectClass,
    templateId: current.board.templateId, title: null, scale: 1, a4SourceFit: ctx.a4SourceFit,
    slides: current.board.slots.map(slot => ({ index: slot.sourceSlideNumber! - 1,
      buffer: cat.approved.get(slot.sourceSlideNumber!)!.bytes })) });
  if (base.manifest.slots.some((slot, index) => !equal(slot.sourceFit, current.board!.slots[index].receipt?.sourceFit))) {
    fail("PRODUCTION_SNAPSHOT_SOURCE_FIT_CHANGED");
  }
  assertFlatRedactionPng(base.bytes);
  if (titleState) {
    const title = titleState.activeTitle!;
    const layout = await validateThumbnailTitleLayout(title, ctx.suite.aspectClass as ThumbnailTitleAspectClass);
    const [draft, final] = await Promise.all([
      productionTitleManifest(store, input, titleState.draft!),
      productionTitleManifest(store, input, titleState.active!),
    ]);
    const fingerprint = titleInputFingerprint(current.baseFingerprint, overlay!, title);
    for (const manifest of [draft, final]) {
      if (manifest.version !== LOCAL_MOCKUP_TITLE_VERSION || manifest.inputFingerprint !== fingerprint
        || manifest.baseFingerprint !== current.baseFingerprint || manifest.overlayFingerprint !== overlay
        || !equal(manifest.title, title) || !equal(manifest.layout, layout)) fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
    }
    if (!equal(final.baseRender, base.manifest)
      || !compareApprovedBoardDraftAndFinal(draft.baseRender, base.manifest).passed) fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
    const rerender = await renderThumbnailTitleOverlay({ basePng: base.bytes, title,
      aspectClass: ctx.suite.aspectClass as ThumbnailTitleAspectClass, scale: 1 });
    if (redactionHash(rerender.bytes) !== titleState.active!.sha256
      || !equal(titleLayoutProof(rerender.layout), layout)
      || overlay !== await thumbnailTitleOverlayFingerprint()) fail("PRODUCTION_SNAPSHOT_TITLE_STALE");
  }
  const descriptor: ProductionMockupDescriptor = {
    version: PRODUCTION_MOCKUP_SNAPSHOT_VERSION, mode,
    localWorkId: state.workId, buildId: state.buildId, sourceHash: state.sourceHash,
    aspectClass: state.aspectClass, suiteId: state.suiteId, templateVersion: state.templateVersion,
    sourceFormatFingerprint: state.sourceFormatFingerprint ?? null,
    assignmentHash: redactionHash(JSON.stringify(assignmentBindings)), localRevision: state.revision,
    titleRevision: titleState?.revision ?? null, remoteApproval: "required", localConfirmation: "technical_candidate_only",
    boards: boards.map(({ png, ...board }) => { void png; return board; }),
    thumbnail: { templateId: current.board.templateId, baseImageHash: redactionHash(base.bytes),
      baseFingerprint: current.baseFingerprint, overlayFingerprint: overlay,
      titleSpec: titleState ? normalizeThumbnailTitleSpec(titleState.activeTitle) : null,
      titleImageHash: boards.find(board => board.kind === "thumbnail")!.imageHash,
      localConfirmed: Boolean(titleState) },
  };
  return { descriptor, snapshotHash: productionSnapshotHash(descriptor), boards, titlelessBasePng: base.bytes };
}

/** Read-only candidate description for a separately authorized destination ticket. */
export async function getVerifiedProductionMockupDescriptor(input: MockupIdentity,
  options: { mode: ProductionMockupSnapshotMode }) {
  productionSnapshotMode(options?.mode);
  return locked(input, async store => {
    const { descriptor, snapshotHash } = await createVerifiedProductionSnapshot(store, input, options.mode);
    return { descriptor, snapshotHash };
  });
}

/** Not an HTTP endpoint and not remote approval. Caller must authorize the
 * destination and enforce its own one-use/idempotent ticket. The snapshot hash
 * rejects stale or cross-mode replays; identical retries remain read-only.
 * The work lock spans verification AND callback, including transport failures. */
export async function withVerifiedProductionMockupSnapshot<T>(input: MockupIdentity,
  options: { mode: ProductionMockupSnapshotMode; expectedSnapshotHash: string },
  operation: (snapshot: ProductionMockupSnapshot) => Promise<T>): Promise<T> {
  productionSnapshotMode(options?.mode);
  if (!titleSha(options.expectedSnapshotHash)) fail("PRODUCTION_SNAPSHOT_EXPECTATION_REQUIRED");
  return locked(input, async store => {
    const snapshot = await createVerifiedProductionSnapshot(store, input, options.mode);
    if (snapshot.snapshotHash !== options.expectedSnapshotHash) fail("PRODUCTION_SNAPSHOT_STALE");
    return operation(snapshot);
  });
}
