import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPrivateWorkRoot } from "./private-work-root.ts";
import { PREPARATION_RULE_VERSION, sha256, type PptxInspection } from "./pptx-inspection.ts";
import { openPreparationWorkStore, type JsonValue, type PreparationBuildRecord, type PreparationWorkStore } from "./work-store.ts";
import { exportLocalPowerPointSlides, getLocalPowerPointConverterFingerprint, getLocalPowerPointRuntime } from "./powerpoint-adapter.ts";
import type { PreparationDependencies } from "./pipeline.ts";
import { previewCandidate, validatePreparedPng, type PreviewCheck, type PreparationSelection, type SlideArtworkReview } from "./slide-preparation.ts";
import { readSourceFormatChoice, sourceFormatFingerprint, validateSourceFormatChoice, type SourceFormatChoice, type SourceFormatChoiceReceipt } from "./source-format-choice.ts";
import type { PreparationEvidenceRead, PreparationEvidenceRequest, PreparationReviewApplyInput, PreparationReviewBuild, PreparationReviewSlide, PreparationReviewView, PreparationVisualDecision } from "./preparation-review-types.ts";

export type PreparationReviewIdentity = { sourcePath: string; workRoot: string; workId: string; buildId: string };
export type PreparationReviewOptions = {
  sourceFormatChoice?: SourceFormatChoice;
  artworkReviews?: SlideArtworkReview[];
  expectedCurrentBuild: PreparationReviewBuild;
};
type Context = { identity: PreparationReviewIdentity; store: PreparationWorkStore; build: PreparationBuildRecord;
  inspection: PptxInspection; choice: SourceFormatChoiceReceipt | undefined; selection: PreparationSelection;
  sourceHash: string; assertSource: () => Promise<void> };
type Evidence = { bytes: Buffer; checked: PreviewCheck };
const hashPattern = /^[a-f0-9]{64}$/;
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
function fail(code: string): never { throw new Error(code); }
function exact(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || keys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key))) fail("PREPARATION_REVIEW_INVALID");
}
function note(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > maximum
    || /[\x00-\x1f\x7f]/.test(value)) fail("PREPARATION_REVIEW_REASON_REQUIRED");
  return value.trim();
}
function assertExpected(ctx: Context, expected: PreparationReviewBuild) {
  exact(expected, ["buildId", "revision", "sourceHash"]);
  if (expected.buildId !== ctx.build.buildId || expected.revision !== ctx.build.revision
    || expected.sourceHash !== ctx.sourceHash || !Number.isSafeInteger(expected.revision)) fail("PREPARATION_REVIEW_STALE");
}
async function locked<T>(identity: PreparationReviewIdentity, operation: (ctx: Context) => Promise<T>): Promise<T> {
  if (path.extname(identity.sourcePath).toLowerCase() !== ".pptx") fail("PPTX_REQUIRED");
  const locations = await assertPrivateWorkRoot(identity.sourcePath, identity.workRoot);
  const sourceStat = await stat(locations.sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > 256 * 1024 * 1024) fail("INVALID_SOURCE_FILE");
  const store = await openPreparationWorkStore({ root: locations.workRoot });
  try {
    const work = await store.readWork();
    if (!work || work.workId !== identity.workId || work.currentBuildId !== identity.buildId) fail("PREPARATION_REVIEW_STALE");
    const build = await store.readBuild(identity.buildId);
    const source = await readFile(locations.sourcePath), sourceHash = sha256(source);
    if (build.fingerprint.source.sha256 !== sourceHash || build.fingerprint.source.bytes !== source.length) fail("PREPARATION_REVIEW_SOURCE_CHANGED");
    const stage = await store.getReusableStage(identity.buildId, "source_inspection");
    const artifact = await store.getReusableArtifact(identity.buildId, "inspection");
    if (!stage || !stage.artifactKeys.includes("inspection") || !artifact) fail("PREPARATION_REVIEW_INSPECTION_STALE");
    const bytes = await readFile(artifact.absolutePath);
    if (sha256(bytes) !== artifact.record.sha256 || bytes.length > 32 * 1024 * 1024) fail("PREPARATION_REVIEW_INSPECTION_STALE");
    let inspection: PptxInspection;
    try { inspection = JSON.parse(bytes.toString("utf8")); } catch { fail("PREPARATION_REVIEW_INSPECTION_STALE"); }
    if (!inspection || inspection.sourceHash !== sourceHash || !Number.isFinite(inspection.width)
      || !Number.isFinite(inspection.height) || inspection.width <= 0 || inspection.height <= 0
      || !Array.isArray(inspection.slides) || !Array.isArray(inspection.issues)
      || JSON.stringify(inspection) !== JSON.stringify(stage.data)) fail("PREPARATION_REVIEW_INSPECTION_STALE");
    const selectionStage = await store.getReusableStage(identity.buildId, "slide_selection");
    const selection = selectionStage?.data as unknown as PreparationSelection;
    if (!selection || selection.version !== 1 || !Array.isArray(selection.slides) || !Array.isArray(selection.holds)) fail("PREPARATION_REVIEW_SELECTION_STALE");
    const choice = await readSourceFormatChoice(store, identity.buildId, inspection);
    const assertSource = async () => { if (sha256(await readFile(locations.sourcePath)) !== sourceHash) fail("PREPARATION_REVIEW_SOURCE_CHANGED"); };
    const result = await operation({ identity: { ...identity, ...locations }, store, build, inspection, choice, selection, sourceHash, assertSource });
    await assertSource();
    return result;
  } finally { await store.release(); }
}
function formatAllowed(ctx: Context) {
  try {
    return Boolean(validateSourceFormatChoice(ctx.inspection, { kind: "custom_portrait_to_a4", aspectClass: "a4_portrait",
      sourceHash: ctx.sourceHash, reviewedBy: "Local preparation review", reason: "Compatibility check only; not a user decision" }));
  } catch { return false; }
}
function candidateNumbers(ctx: Context) {
  const formatSlide = formatAllowed(ctx) ? ctx.inspection.slides.find(previewCandidate)?.sourceSlideNumber ?? null : null;
  const numbers = new Set(ctx.inspection.slides.filter((slide) => slide.issues.some((issue) => issue.code === "PHOTO_DENSE"))
    .map((slide) => slide.sourceSlideNumber));
  if (formatSlide !== null) numbers.add(formatSlide);
  return { formatSlide, numbers };
}
const blockingArtworkCodes = new Set(["HIDDEN", "EMPTY_OR_DECORATION_ONLY", "CORRUPT_SLIDE", "TABLE_DENSE",
  "MEDIA_UNRESOLVED", "MEDIA_CLASSIFICATION_REVIEW", "UNINSPECTABLE_OBJECT", "INHERITED_MEDIA_UNRESOLVED",
  "INHERITED_OBJECT_REVIEW", "FONT_UNRESOLVED"]);
function artworkEligible(ctx: Context, number: number) {
  const slide = ctx.inspection.slides.find((row) => row.sourceSlideNumber === number);
  return Boolean(slide && slide.issues.some((issue) => issue.code === "PHOTO_DENSE")
    && !slide.issues.some((issue) => blockingArtworkCodes.has(issue.code))
    && !slide.missingFonts.length && !slide.embeddedUnverifiedFonts.length);
}
/** Existing registered raw images can be read as private evidence, but never
 * acquire redaction approval, a completed conversion stage, or an upload receipt. */
async function evidence(ctx: Context, number: number, longEdge: 800 | 2400): Promise<Evidence | null> {
  const keys = longEdge === 800 ? [`preview:${number}`, `preparation-review-preview:${number}`]
    : [`highres:${number}`, `preparation-review-evidence:${number}`];
  const key = keys.find((candidate) => Object.hasOwn(ctx.build.artifacts, candidate));
  if (!key) return null;
  const artifact = await ctx.store.getReusableArtifact(ctx.build.buildId, key);
  if (!artifact) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
  const bytes = await readFile(artifact.absolutePath);
  if (sha256(bytes) !== artifact.record.sha256) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
  const checked = await validatePreparedPng(bytes, { sourceSlideNumber: number, slideWidth: ctx.inspection.width,
    slideHeight: ctx.inspection.height, longEdge });
  if (checked.blank) fail("PREPARATION_REVIEW_EVIDENCE_BLANK");
  if (key.startsWith("preparation-review-")) {
    const data = artifact.record.data as Record<string, JsonValue> | null;
    const slide = ctx.inspection.slides.find((row) => row.sourceSlideNumber === number);
    if (!data || data.version !== 1 || data.sourceHash !== ctx.sourceHash || data.slideContentHash !== slide?.contentHash
      || data.imageHash !== checked.sha256 || data.longEdge !== longEdge || data.redacted !== false || data.localOnly !== true) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
  }
  return { bytes, checked };
}
function buildProof(ctx: Context): PreparationReviewBuild {
  return { buildId: ctx.build.buildId, revision: ctx.build.revision, sourceHash: ctx.sourceHash };
}
async function view(ctx: Context): Promise<PreparationReviewView> {
  const { formatSlide, numbers } = candidateNumbers(ctx), slides: PreparationReviewSlide[] = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const slide = ctx.inspection.slides.find((row) => row.sourceSlideNumber === number)!;
    const preview = await evidence(ctx, number, 800), full = await evidence(ctx, number, 2400);
    slides.push({ sourceSlideNumber: number, slideContentHash: slide.contentHash, previewHash: preview?.checked.sha256 ?? null,
      evidence: full ? { imageHash: full.checked.sha256, width: full.checked.width, height: full.checked.height } : null,
      artworkEligible: artworkEligible(ctx, number), artworkReviewed: Boolean(ctx.selection.artworkReviews?.some((review) => review.sourceSlideNumber === number)),
      reasons: [...new Set([...slide.issues.map((issue) => issue.code), ...(slide.missingFonts.length ? ["MISSING_FONTS"] : []),
        ...(slide.embeddedUnverifiedFonts.length ? ["EMBEDDED_FONT_UNVERIFIED"] : [])])] });
  }
  return { version: 1, ...buildProof(ctx), workId: ctx.identity.workId,
    source: { width: ctx.inspection.width, height: ctx.inspection.height, aspect: ctx.inspection.aspect, pageSizeVariant: ctx.inspection.pageSizeVariant },
    customPortrait: { allowed: formatAllowed(ctx), reviewSlideNumber: formatSlide, currentChoice: Boolean(ctx.choice),
      reason: formatAllowed(ctx) ? "A4 세로 비율과 차이가 3% 이내입니다. 원본 비율을 유지하고 흰 여백만 추가합니다. 블러 승인은 별도입니다."
        : "사용자 지정 세로 규격 보정 대상이 아닙니다. 다른 규격·폰트·표·사진 제외 규칙은 그대로 유지됩니다." },
    slides, holds: [...ctx.selection.holds], localOnly: true };
}
export async function getPreparationReview(identity: PreparationReviewIdentity): Promise<PreparationReviewView> {
  return locked(identity, view);
}
async function assertEnvironment(ctx: Context, dependencies: PreparationDependencies) {
  const runtime = await (dependencies.runtime ?? getLocalPowerPointRuntime)();
  const converterFingerprint = await (dependencies.converterFingerprint ?? getLocalPowerPointConverterFingerprint)();
  const rulesHash = sha256(Buffer.concat(await Promise.all(["./pptx-inspection.ts", "./slide-preparation.ts", "./source-format-choice.ts"]
    .map((file) => readFile(new URL(file, import.meta.url))))));
  const settings = sha256(JSON.stringify({ version: PREPARATION_RULE_VERSION, converterFingerprint, rulesHash,
    preview: 800, highResolution: 2400, powerPointVersion: runtime.powerPointVersion, sourceFormatFingerprint: sourceFormatFingerprint(ctx.choice) }));
  if (runtime.fontInventory.fingerprint !== ctx.build.fingerprint.fontFingerprint
    || settings !== ctx.build.fingerprint.conversionSettingsFingerprint) fail("PREPARATION_ENVIRONMENT_CHANGED_NEW_BUILD_REQUIRED");
  if (!runtime.available) fail("POWERPOINT_NOT_AVAILABLE");
}
/** Explicit private-only evidence rendering, including an otherwise unsupported
 * custom format. This does not call prepareLocalPptx or bypass its suite hold. */
export async function preparePreparationReviewEvidence(identity: PreparationReviewIdentity, input: PreparationEvidenceRequest,
  dependencies: PreparationDependencies = {}): Promise<PreparationReviewView> {
  exact(input, ["expectedCurrentBuild", "slideNumbers"]);
  if (!Array.isArray(input.slideNumbers) || input.slideNumbers.length < 1 || input.slideNumbers.length > 20
    || input.slideNumbers.some((number) => !Number.isSafeInteger(number) || number < 1)
    || new Set(input.slideNumbers).size !== input.slideNumbers.length) fail("PREPARATION_REVIEW_INVALID_SLIDES");
  return locked(identity, async (ctx) => {
    assertExpected(ctx, input.expectedCurrentBuild);
    const { numbers } = candidateNumbers(ctx);
    if (input.slideNumbers.some((number) => !numbers.has(number)
      || !previewCandidate(ctx.inspection.slides.find((slide) => slide.sourceSlideNumber === number)!))) fail("PREPARATION_REVIEW_SLIDE_NOT_ALLOWED");
    let environmentChecked = false;
    for (const longEdge of [800, 2400] as const) {
      const pending: number[] = [];
      for (const number of input.slideNumbers) if (!await evidence(ctx, number, longEdge)) pending.push(number);
      if (!pending.length) continue;
      if (!environmentChecked) { await assertEnvironment(ctx, dependencies); environmentChecked = true; }
      await ctx.assertSource();
      const attemptRoot = path.dirname(await ctx.store.prepareArtifactPath(ctx.build.buildId, `attempts/preparation-review-${randomUUID()}/marker`));
      const requested = new Set(pending), received = new Map<number, { file: string; checked: PreviewCheck }>();
      const output = await (dependencies.exportSlides ?? exportLocalPowerPointSlides)({ sourcePath: ctx.identity.sourcePath,
        sourceHash: ctx.sourceHash, outputDirectory: attemptRoot, slideNumbers: pending, longEdge,
        expectedSlideWidth: ctx.inspection.width, expectedSlideHeight: ctx.inspection.height }, {
        onSlide: async (slide) => {
          if (!requested.has(slide.sourceSlideNumber) || received.has(slide.sourceSlideNumber)) fail("UNEXPECTED_EXPORTED_SLIDE");
          const relative = path.relative(attemptRoot, path.resolve(slide.path));
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("UNSAFE_EXPORT_PATH");
          let cursor = attemptRoot;
          for (const segment of relative.split(path.sep)) { cursor = path.join(cursor, segment); if ((await lstat(cursor)).isSymbolicLink()) fail("UNSAFE_EXPORT_LINK"); }
          const png = await readFile(slide.path), checked = await validatePreparedPng(png, {
            sourceSlideNumber: slide.sourceSlideNumber, slideWidth: ctx.inspection.width, slideHeight: ctx.inspection.height, longEdge });
          if (checked.blank) fail("PREPARATION_REVIEW_EVIDENCE_BLANK");
          if (checked.width !== slide.width || checked.height !== slide.height) fail("EXPORT_METADATA_MISMATCH");
          await ctx.assertSource();
          received.set(slide.sourceSlideNumber, { file: slide.path, checked });
        },
      });
      if (received.size !== requested.size) fail("INCOMPLETE_EXPORT_BATCH");
      if (output.sourceHash !== ctx.sourceHash) fail("POWERPOINT_SOURCE_HASH_MISMATCH");
      if (Math.abs(output.slideWidth / ctx.inspection.width - 1) > .001
        || Math.abs(output.slideHeight / ctx.inspection.height - 1) > .001) fail("POWERPOINT_PAGE_SETUP_MISMATCH");
      await ctx.assertSource();
      // No evidence is registered until the whole exporter batch has passed.
      for (const [number, item] of received) {
        const bytes = await readFile(item.file);
        if (sha256(bytes) !== item.checked.sha256) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
        const kind = longEdge === 800 ? "preview" : "evidence", relativePath = `preparation-review/${kind}-${number}-${randomUUID()}.png`;
        const destination = await ctx.store.prepareArtifactPath(ctx.build.buildId, relativePath), temporary = `${destination}.pending-${randomUUID()}`;
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 }); await rename(temporary, destination);
        ctx.build = await ctx.store.recordArtifact({ buildId: ctx.build.buildId, key: `preparation-review-${kind}:${number}`,
          expectedRevision: ctx.build.revision, relativePath, data: json({ version: 1, sourceHash: ctx.sourceHash,
            slideContentHash: ctx.inspection.slides.find((slide) => slide.sourceSlideNumber === number)!.contentHash,
            imageHash: item.checked.sha256, longEdge, width: item.checked.width, height: item.checked.height, redacted: false, localOnly: true }) });
      }
    }
    return view(ctx);
  });
}
export async function readPreparationReviewEvidence(identity: PreparationReviewIdentity, input: PreparationEvidenceRead): Promise<Buffer> {
  exact(input, ["expectedCurrentBuild", "sourceSlideNumber", "imageHash"]);
  return locked(identity, async (ctx) => {
    assertExpected(ctx, input.expectedCurrentBuild);
    if (!Number.isSafeInteger(input.sourceSlideNumber) || !candidateNumbers(ctx).numbers.has(input.sourceSlideNumber)
      || typeof input.imageHash !== "string" || !hashPattern.test(input.imageHash)) fail("PREPARATION_REVIEW_SLIDE_NOT_ALLOWED");
    const image = await evidence(ctx, input.sourceSlideNumber, 2400);
    if (!image || image.checked.sha256 !== input.imageHash) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
    return image.bytes;
  });
}
async function decision(ctx: Context, value: PreparationVisualDecision, extra: string) {
  exact(value, ["sourceSlideNumber", "slideContentHash", "previewHash", "imageHash", "inspectedAtActualSize", "reason", extra]);
  if (!Number.isSafeInteger(value.sourceSlideNumber) || !candidateNumbers(ctx).numbers.has(value.sourceSlideNumber)
    || value.inspectedAtActualSize !== true) fail("PREPARATION_REVIEW_VISUAL_CONFIRMATION_REQUIRED");
  const reason = note(value.reason, 500), slide = ctx.inspection.slides.find((row) => row.sourceSlideNumber === value.sourceSlideNumber)!;
  const preview = await evidence(ctx, value.sourceSlideNumber, 800), full = await evidence(ctx, value.sourceSlideNumber, 2400);
  if (!preview || !full || value.slideContentHash !== slide.contentHash || value.previewHash !== preview.checked.sha256
    || value.imageHash !== full.checked.sha256) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
  return reason;
}
/** Validation only. The trusted daemon may prepare an isolated new generation
 * with these options; neither this call nor its evidence is publication approval. */
export async function applyPreparationReview(identity: PreparationReviewIdentity, input: PreparationReviewApplyInput,
  actor: { reviewedBy: string }): Promise<PreparationReviewOptions> {
  exact(input, ["expectedCurrentBuild", "artworkReviews"], ["sourceFormatChoice"]);
  const reviewedBy = note(actor.reviewedBy, 100);
  if (!Array.isArray(input.artworkReviews) || input.artworkReviews.length > 500) fail("PREPARATION_REVIEW_INVALID");
  if (input.sourceFormatChoice === undefined && !input.artworkReviews.length) fail("PREPARATION_REVIEW_NO_CHANGES");
  return locked(identity, async (ctx) => {
    assertExpected(ctx, input.expectedCurrentBuild);
    let sourceFormatChoice: SourceFormatChoice | undefined = ctx.choice;
    if (input.sourceFormatChoice !== undefined) {
      const value = input.sourceFormatChoice;
      const reason = await decision(ctx, value, "kind");
      if (value.kind !== "custom_portrait_to_a4" || !formatAllowed(ctx)
        || value.sourceSlideNumber !== candidateNumbers(ctx).formatSlide) fail("SOURCE_FORMAT_NOT_COMPATIBLE");
      sourceFormatChoice = { kind: value.kind, aspectClass: "a4_portrait", sourceHash: ctx.sourceHash, reviewedBy, reason };
      validateSourceFormatChoice(ctx.inspection, sourceFormatChoice);
    }
    const reviews = new Map<number, SlideArtworkReview>();
    for (const review of ctx.selection.artworkReviews ?? []) {
      const slide = ctx.inspection.slides.find((row) => row.sourceSlideNumber === review.sourceSlideNumber);
      const preview = await evidence(ctx, review.sourceSlideNumber, 800);
      if (!slide || !preview || review.sourceHash !== ctx.sourceHash || review.slideContentHash !== slide.contentHash
        || review.previewHash !== preview.checked.sha256 || !artworkEligible(ctx, review.sourceSlideNumber)) fail("PREPARATION_REVIEW_EVIDENCE_STALE");
      reviews.set(review.sourceSlideNumber, { sourceHash: review.sourceHash, sourceSlideNumber: review.sourceSlideNumber,
        slideContentHash: review.slideContentHash, previewHash: review.previewHash, classification: "abstract_graphic",
        reviewedBy: note(review.reviewedBy, 100), reason: note(review.reason, 500), inspectedAtFullResolution: true });
    }
    const submitted = new Set<number>();
    for (const value of input.artworkReviews) {
      const reason = await decision(ctx, value, "classification");
      if (value.classification !== "abstract_graphic" || !artworkEligible(ctx, value.sourceSlideNumber)
        || submitted.has(value.sourceSlideNumber)) fail("PREPARATION_REVIEW_ARTWORK_NOT_ALLOWED");
      submitted.add(value.sourceSlideNumber);
      reviews.set(value.sourceSlideNumber, { sourceHash: ctx.sourceHash, slideContentHash: value.slideContentHash,
        previewHash: value.previewHash, sourceSlideNumber: value.sourceSlideNumber, classification: "abstract_graphic",
        reviewedBy, reason, inspectedAtFullResolution: true });
    }
    return { ...(sourceFormatChoice ? { sourceFormatChoice: { kind: sourceFormatChoice.kind, aspectClass: sourceFormatChoice.aspectClass,
      sourceHash: sourceFormatChoice.sourceHash, reviewedBy: sourceFormatChoice.reviewedBy, reason: sourceFormatChoice.reason } } : {}),
      ...(reviews.size ? { artworkReviews: [...reviews.values()] } : {}), expectedCurrentBuild: buildProof(ctx) };
  });
}
