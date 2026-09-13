import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalMockupReview } from "./mockup-service.ts";
import { LOCAL_MOCKUP_VERSION, type LocalMockupState } from "./mockup-types.ts";
import { initializePptxRedactions } from "./redaction-service.ts";
import type { RedactionState } from "./redaction-types.ts";
import {
  exportLocalPowerPointSlides,
  getLocalPowerPointConverterFingerprint,
  getLocalPowerPointRuntime,
  type LocalPowerPointExportInput,
  type LocalPowerPointExportOptions,
  type LocalPowerPointExportResult,
  type LocalPowerPointRuntime,
} from "./powerpoint-adapter.ts";
import { PREPARATION_RULE_VERSION, sha256, type PptxInspection } from "./pptx-inspection.ts";
import { assertPrivateWorkRoot } from "./private-work-root.ts";
import { readSourceFormatChoice, sourceFormatFingerprint } from "./source-format-choice.ts";
import { validatePreparedPng, type PreparationSelection } from "./slide-preparation.ts";
import {
  openPreparationWorkStore,
  type JsonValue,
  type PreparationBuildRecord,
  type PreparationStageRecord,
} from "./work-store.ts";

export type MockupRequestPreparationDependencies = {
  runtime?: () => Promise<LocalPowerPointRuntime>;
  converterFingerprint?: () => Promise<string>;
  exportSlides?: (
    input: LocalPowerPointExportInput,
    options: LocalPowerPointExportOptions,
  ) => Promise<LocalPowerPointExportResult>;
  initializeRedactions?: typeof initializePptxRedactions;
};

export type MockupRequestPreparationHold = {
  requestId: string;
  sourceSlideNumber: number;
  code: "SLIDE_NOT_ELIGIBLE";
  reasons: string[];
};

export type PreparedMockupRequest = {
  requestId: string;
  sourceSlideNumber: number;
  highResolution: "created" | "reused";
  redactionRevision: number;
  redactionStatus: RedactionState["status"];
};

export type MockupRequestPreparationResult = {
  workRoot: string;
  workId: string;
  buildId: string;
  status: "ready_for_manual_redaction" | "held";
  prepared: PreparedMockupRequest[];
  holds: MockupRequestPreparationHold[];
  selectionRevision: number;
  activeSetUnchanged: true;
};

type ProgressEvent = {
  stage: "request_validation" | "highres" | "slide_selection" | "redaction_initialization";
  sourceSlideNumber?: number;
  reused?: boolean;
};

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code: string): never {
  throw new Error(code);
}

async function atomicArtifact(destination: string, bytes: Buffer) {
  const temporary = `${destination}.pending-${randomUUID()}`;
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
}

async function currentPreparationEnvironment(dependencies: MockupRequestPreparationDependencies, formatFingerprint?: string) {
  const runtime = await (dependencies.runtime ?? getLocalPowerPointRuntime)();
  const converterFingerprint = await (
    dependencies.converterFingerprint ?? getLocalPowerPointConverterFingerprint
  )();
  const rulesHash = sha256(Buffer.concat(await Promise.all([
    "./pptx-inspection.ts",
    "./slide-preparation.ts",
    "./source-format-choice.ts",
  ].map((file) => readFile(new URL(file, import.meta.url))))));
  const conversionSettingsFingerprint = sha256(JSON.stringify({
    version: PREPARATION_RULE_VERSION,
    converterFingerprint,
    rulesHash,
    preview: 800,
    highResolution: 2400,
    powerPointVersion: runtime.powerPointVersion,
    sourceFormatFingerprint: formatFingerprint,
  }));
  return { runtime, conversionSettingsFingerprint };
}

function requestedSelection(
  current: PreparationSelection,
  requests: { id: string; sourceSlideNumber: number }[],
) {
  const next = structuredClone(current);
  const available = new Set([...next.selected, ...next.reserves]);
  const accepted: { id: string; sourceSlideNumber: number }[] = [];
  const holds: MockupRequestPreparationHold[] = [];
  for (const request of requests) {
    const row = next.slides.find((slide) => slide.sourceSlideNumber === request.sourceSlideNumber);
    if (!row || (row.disposition !== "candidate" && !available.has(request.sourceSlideNumber))) {
      holds.push({
        requestId: request.id,
        sourceSlideNumber: request.sourceSlideNumber,
        code: "SLIDE_NOT_ELIGIBLE",
        reasons: row?.reasons.length ? [...row.reasons] : ["선별 가능한 장표가 아닙니다."],
      });
      continue;
    }
    accepted.push(request);
    if (available.has(request.sourceSlideNumber)) continue;
    next.reserves.push(request.sourceSlideNumber);
    available.add(request.sourceSlideNumber);
    row.disposition = "reserve";
    if (!row.reasons.includes("사용자가 목업에서 새 장표 준비를 요청함")) {
      row.reasons.push("사용자가 목업에서 새 장표 준비를 요청함");
    }
  }
  return { next, accepted, holds };
}

function assertSelection(value: unknown): asserts value is PreparationSelection {
  const selection = value as Partial<PreparationSelection> | null;
  if (!selection || selection.version !== 1 || selection.status !== "ready_for_local_review"
    || !Array.isArray(selection.selected) || !Array.isArray(selection.reserves)
    || !Array.isArray(selection.slides) || !Array.isArray(selection.holds)) {
    fail("MOCKUP_REQUEST_SELECTION_NOT_READY");
  }
}

function assertMockupState(
  value: unknown,
  input: { buildId: string; workId: string; sourceHash: string; expectedRevision: number },
): asserts value is LocalMockupState {
  const state = value as Partial<LocalMockupState> | null;
  if (!state || state.version !== LOCAL_MOCKUP_VERSION || state.buildId !== input.buildId
    || state.workId !== input.workId || state.sourceHash !== input.sourceHash
    || state.revision !== input.expectedRevision || !Array.isArray(state.requests)) {
    fail("MOCKUP_REQUEST_REVISION_CONFLICT");
  }
}

async function restorePreviousSelection(
  build: PreparationBuildRecord,
  previousSelection: PreparationStageRecord,
  previousHighResolution: PreparationStageRecord,
  store: Awaited<ReturnType<typeof openPreparationWorkStore>>,
) {
  let restored = await store.recordSelection({
    buildId: build.buildId,
    expectedRevision: build.revision,
    expectedSelectionRevision: build.selectionRevision,
    selectionFingerprint: previousSelection.inputFingerprint,
    data: previousSelection.data,
  });
  restored = await store.completeStage({
    buildId: build.buildId,
    stage: "high_resolution_conversion",
    expectedRevision: restored.revision,
    inputFingerprint: previousHighResolution.inputFingerprint,
    artifactKeys: [...previousHighResolution.artifactKeys],
    data: previousHighResolution.data,
  });
  return restored;
}

/**
 * Explicit, local-only consumer for requests recorded by the mockup board.
 * It prepares source PNGs and initializes manual redaction state, but never
 * renders, approves, uploads, publishes, or changes the active set.
 */
export async function preparePendingLocalMockupRequests(input: {
  sourcePath: string;
  workRoot: string;
  buildId: string;
  requestIds?: readonly string[];
  onProgress?: (event: ProgressEvent) => void;
}, dependencies: MockupRequestPreparationDependencies = {}): Promise<MockupRequestPreparationResult> {
  if (path.extname(input.sourcePath).toLowerCase() !== ".pptx") fail("PPTX_REQUIRED");
  if (!uuidPattern.test(input.buildId)) fail("INVALID_BUILD_ID");
  if (input.requestIds && (new Set(input.requestIds).size !== input.requestIds.length
    || input.requestIds.some((id) => !uuidPattern.test(id)))) fail("INVALID_MOCKUP_REQUEST_IDS");

  const { sourcePath, workRoot } = await assertPrivateWorkRoot(input.sourcePath, input.workRoot);
  if (process.platform === "win32" && workRoot.length > 100) fail("WORK_ROOT_TOO_LONG");
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > 256 * 1024 * 1024) fail("INVALID_SOURCE_FILE");
  const source = await readFile(sourcePath);
  const sourceHash = sha256(source);

  const initialReview = await getLocalMockupReview({ root: workRoot, buildId: input.buildId });
  if (initialReview.state === null || initialReview.revision === null) fail("MOCKUP_NOT_INITIALIZED");
  const requestedIds = input.requestIds ? new Set(input.requestIds) : null;
  const allIds = new Set(initialReview.requests.map((request) => request.id));
  if (requestedIds && [...requestedIds].some((id) => !allIds.has(id))) fail("MOCKUP_REQUEST_NOT_FOUND");
  const pending = initialReview.requests
    .filter((request) => request.status === "pending" && (!requestedIds || requestedIds.has(request.id)))
    .map(({ id, sourceSlideNumber }) => ({ id, sourceSlideNumber }));

  if (!pending.length) {
    return {
      workRoot,
      workId: initialReview.workId,
      buildId: input.buildId,
      status: "ready_for_manual_redaction",
      prepared: [],
      holds: [],
      selectionRevision: (await (async () => {
        const store = await openPreparationWorkStore({ root: workRoot });
        try { return (await store.readBuild(input.buildId)).selectionRevision; }
        finally { await store.release(); }
      })()),
      activeSetUnchanged: true,
    };
  }

  const highResolutionState = new Map<number, "created" | "reused">();
  let accepted: { id: string; sourceSlideNumber: number }[] = [];
  let holds: MockupRequestPreparationHold[] = [];
  let selectionRevision = 0;
  const store = await openPreparationWorkStore({ root: workRoot });
  try {
    const work = await store.readWork();
    if (!work || work.currentBuildId !== input.buildId || work.workId !== initialReview.workId) fail("MOCKUP_BUILD_NOT_CURRENT");
    let build = await store.readBuild(input.buildId);
    if (build.fingerprint.source.sha256 !== sourceHash || build.fingerprint.source.bytes !== source.length) fail("SOURCE_BUILD_MISMATCH");
    const inspectionStage = await store.getReusableStage(input.buildId, "source_inspection");
    const previewStage = await store.getReusableStage(input.buildId, "preview_generation");
    const selectionStage = await store.getReusableStage(input.buildId, "slide_selection");
    const previousHighResolution = await store.getReusableStage(input.buildId, "high_resolution_conversion");
    if (!inspectionStage || !previewStage || !selectionStage || !previousHighResolution) fail("MOCKUP_REQUEST_PREPARATION_INCOMPLETE");
    const inspection = inspectionStage.data as unknown as PptxInspection;
    if (!inspection || inspection.sourceHash !== sourceHash || !Number.isFinite(inspection.width)
      || !Number.isFinite(inspection.height) || !Array.isArray(inspection.slides)) fail("MOCKUP_REQUEST_INSPECTION_STALE");
    const sourceFormatChoice = await readSourceFormatChoice(store, input.buildId, inspection);
    const { runtime, conversionSettingsFingerprint } = await currentPreparationEnvironment(dependencies, sourceFormatFingerprint(sourceFormatChoice));
    if (build.fingerprint.fontFingerprint !== runtime.fontInventory.fingerprint
      || build.fingerprint.conversionSettingsFingerprint !== conversionSettingsFingerprint) {
      fail("PREPARATION_ENVIRONMENT_CHANGED_NEW_BUILD_REQUIRED");
    }
    assertSelection(selectionStage.data);

    const stateArtifact = await store.getReusableArtifact(input.buildId, "mockup-state");
    if (!stateArtifact) fail("MOCKUP_STATE_CORRUPT");
    const state = JSON.parse((await readFile(stateArtifact.absolutePath)).toString("utf8"));
    assertMockupState(state, {
      buildId: input.buildId,
      workId: work.workId,
      sourceHash,
      expectedRevision: initialReview.revision,
    });
    const stateRequestIds = new Set(state.requests.map((request) => request.id));
    if (pending.some((request) => !stateRequestIds.has(request.id))) fail("MOCKUP_REQUEST_REVISION_CONFLICT");

    input.onProgress?.({ stage: "request_validation" });
    const planned = requestedSelection(selectionStage.data, pending);
    accepted = planned.accepted;
    holds = planned.holds;
    const oldAvailable = new Set([...selectionStage.data.selected, ...selectionStage.data.reserves]);
    const newNumbers = [...new Set(accepted.map((request) => request.sourceSlideNumber)
      .filter((number) => !oldAvailable.has(number)))];
    const targetNumbers = [...new Set(accepted.map((request) => request.sourceSlideNumber))];
    const missing: number[] = [];
    for (const sourceSlideNumber of targetNumbers) {
      const cached = await store.getReusableArtifact(input.buildId, `highres:${sourceSlideNumber}`);
      if (cached) {
        try {
          const checked = await validatePreparedPng(await readFile(cached.absolutePath), {
            sourceSlideNumber,
            slideWidth: inspection.width,
            slideHeight: inspection.height,
            longEdge: 2400,
          });
          if (checked.blank) throw new Error("HIGH_RESOLUTION_BLANK");
          highResolutionState.set(sourceSlideNumber, "reused");
          input.onProgress?.({ stage: "highres", sourceSlideNumber, reused: true });
          continue;
        } catch {
          // A corrupt historic artifact is not a reusable completion record.
        }
      }
      missing.push(sourceSlideNumber);
    }

    const assertSource = async () => {
      if (sha256(await readFile(sourcePath)) !== sourceHash) fail("SOURCE_CHANGED_DURING_PREPARATION");
    };
    if (missing.length) {
      if (!runtime.available) fail("POWERPOINT_NOT_AVAILABLE");
      await assertSource();
      const marker = await store.prepareArtifactPath(input.buildId, `attempts/request-${randomUUID()}/marker`);
      const attemptRoot = path.dirname(marker);
      const requested = new Set(missing);
      const received = new Set<number>();
      const output = await (dependencies.exportSlides ?? exportLocalPowerPointSlides)({
        sourcePath,
        sourceHash,
        outputDirectory: attemptRoot,
        slideNumbers: missing,
        longEdge: 2400,
        expectedSlideWidth: inspection.width,
        expectedSlideHeight: inspection.height,
      }, {
        onSlide: async (slide) => {
          const sourceSlideNumber = slide.sourceSlideNumber;
          if (!requested.has(sourceSlideNumber) || received.has(sourceSlideNumber)) fail("UNEXPECTED_EXPORTED_SLIDE");
          const relative = path.relative(attemptRoot, path.resolve(slide.path));
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("UNSAFE_EXPORT_PATH");
          let cursor = attemptRoot;
          for (const segment of relative.split(path.sep)) {
            cursor = path.join(cursor, segment);
            if ((await lstat(cursor)).isSymbolicLink()) fail("UNSAFE_EXPORT_LINK");
          }
          const png = await readFile(slide.path);
          const checked = await validatePreparedPng(png, {
            sourceSlideNumber,
            slideWidth: inspection.width,
            slideHeight: inspection.height,
            longEdge: 2400,
          });
          if (checked.blank) fail(`HIGH_RESOLUTION_BLANK_SLIDE_${sourceSlideNumber}`);
          if (checked.width !== slide.width || checked.height !== slide.height) fail("EXPORT_METADATA_MISMATCH");
          await assertSource();
          const relativePath = `highres/requested-slide-${String(sourceSlideNumber).padStart(4, "0")}-${randomUUID()}.png`;
          const destination = await store.prepareArtifactPath(input.buildId, relativePath);
          await atomicArtifact(destination, png);
          build = await store.recordArtifact({
            buildId: input.buildId,
            key: `highres:${sourceSlideNumber}`,
            expectedRevision: build.revision,
            relativePath,
            data: json(checked),
          });
          highResolutionState.set(sourceSlideNumber, "created");
          received.add(sourceSlideNumber);
          input.onProgress?.({ stage: "highres", sourceSlideNumber, reused: false });
        },
      });
      if (received.size !== requested.size) fail("INCOMPLETE_EXPORT_BATCH");
      if (output.sourceHash !== sourceHash) fail("POWERPOINT_SOURCE_HASH_MISMATCH");
      if (Math.abs(output.slideWidth / inspection.width - 1) > .001
        || Math.abs(output.slideHeight / inspection.height - 1) > .001) fail("POWERPOINT_PAGE_SETUP_MISMATCH");
      await assertSource();
    }

    const currentHighKeys = new Set(previousHighResolution.artifactKeys);
    const refreshHighResolution = newNumbers.length > 0
      || targetNumbers.some((number) => !currentHighKeys.has(`highres:${number}`));
    if (newNumbers.length || refreshHighResolution) {
      const selectionFingerprint = newNumbers.length
        ? sha256(JSON.stringify(planned.next))
        : build.selectionFingerprint;
      if (!selectionFingerprint) fail("MOCKUP_REQUEST_SELECTION_NOT_READY");
      let committed = false;
      try {
        if (newNumbers.length) {
          build = await store.recordSelection({
            buildId: input.buildId,
            expectedRevision: build.revision,
            expectedSelectionRevision: build.selectionRevision,
            selectionFingerprint,
            data: json(planned.next),
          });
          committed = true;
        }
        const highNumbers = [...planned.next.selected, ...planned.next.reserves];
        build = await store.completeStage({
          buildId: input.buildId,
          stage: "high_resolution_conversion",
          expectedRevision: build.revision,
          inputFingerprint: sha256(sourceHash + conversionSettingsFingerprint + selectionFingerprint),
          artifactKeys: highNumbers.map((number) => `highres:${number}`),
          data: json({
            selected: planned.next.selected,
            reserves: planned.next.reserves,
            manualReviewRequired: true,
            redacted: false,
            uploaded: false,
          }),
        });
      } catch (error) {
        if (committed) {
          const current = await store.readBuild(input.buildId);
          await restorePreviousSelection(current, selectionStage, previousHighResolution, store);
        }
        throw error;
      }
      input.onProgress?.({ stage: "slide_selection" });
    }
    selectionRevision = build.selectionRevision;
  } finally {
    await store.release();
  }

  const states = accepted.length
    ? await (dependencies.initializeRedactions ?? initializePptxRedactions)({
      root: workRoot,
      buildId: input.buildId,
      source,
      slideNumbers: accepted.map((request) => request.sourceSlideNumber),
    })
    : [];
  const stateBySlide = new Map(states.map((state) => [state.sourceSlideNumber, state]));
  const prepared = accepted.map((request) => {
    const state = stateBySlide.get(request.sourceSlideNumber);
    if (!state) fail("REDACTION_INITIALIZATION_INCOMPLETE");
    input.onProgress?.({ stage: "redaction_initialization", sourceSlideNumber: request.sourceSlideNumber });
    return {
      requestId: request.id,
      sourceSlideNumber: request.sourceSlideNumber,
      highResolution: highResolutionState.get(request.sourceSlideNumber) ?? "reused",
      redactionRevision: state.revision,
      redactionStatus: state.status,
    } satisfies PreparedMockupRequest;
  });

  return {
    workRoot,
    workId: initialReview.workId,
    buildId: input.buildId,
    status: holds.length ? "held" : "ready_for_manual_redaction",
    prepared,
    holds,
    selectionRevision,
    activeSetUnchanged: true,
  };
}
