import { contentAdmin } from "@/lib/content-ops/data";
import {
  createPortfolioSourceFingerprint,
  PORTFOLIO_RULE_VERSION,
} from "@/lib/content-ops/portfolio-rules";
import { GeminiRequestError, geminiRetryDecision } from "@/lib/gemini/client";
import { createPortfolioDraft } from "./draft";
import type { PortfolioDraftProgress } from "./draft";
import {
  createPortfolioMockups,
  PORTFOLIO_REDACTION_SELECTION_ERROR_CODE,
  PortfolioRedactionSelectionBlocked,
  portfolioMockupIndexes,
} from "./mockup";
import type { GeneratedPortfolioAsset } from "./mockup";
import { createLocalPortfolioReview } from "./local-review";
import {
  createLocalRedactionProof,
  isVerifiedPortfolioRedactionProof,
  localRedactionRegions,
  parseLocalRedactionManifest,
  verifyLocalRedactionSelection,
  type LocalRedactionManifest,
  type PortfolioRedactionProof,
  type PortfolioSlideRedactionProof,
} from "./redaction-proof";
import type {
  PortfolioVisualReview,
  SensitiveRegion,
} from "./visual-review";
import {
  PortfolioCheckpointYield,
  yieldPortfolioCheckpointIfNeeded,
} from "./checkpoint";
import {
  isCompletePortfolioSourceDownload,
  portfolioConversionRecoveryState,
} from "./conversion-retry";
import {
  isPdfPortfolioSource,
  PDF_LOCAL_REDACTION_ERROR_CODE,
  PDF_LOCAL_REDACTION_MESSAGE,
} from "./source-policy";
import {
  createPortfolioGenerationId,
  ownsPortfolioGeneration,
  ownsPortfolioTerminalHold,
  type PortfolioTerminalHoldOwner,
} from "./pipeline-generation";

class PortfolioClaimLost extends Error {
  constructor() {
    super("포트폴리오 작업 실행권이 새 원본 처리로 이전되었습니다.");
    this.name = "PortfolioClaimLost";
  }
}

class PortfolioPdfLocalRedactionUnsupported extends Error {
  constructor() {
    super(`${PDF_LOCAL_REDACTION_ERROR_CODE}: ${PDF_LOCAL_REDACTION_MESSAGE}`);
    this.name = "PortfolioPdfLocalRedactionUnsupported";
  }
}

export class PortfolioRebuildConflict extends Error {
  constructor() {
    super("원고 상태가 바뀌어 다시 만들기를 시작하지 않았습니다. 새로고침 후 다시 확인해 주세요.");
    this.name = "PortfolioRebuildConflict";
  }
}

export class PortfolioConversionRetryConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioConversionRetryConflict";
  }
}

type JobResult = {
  bucket?: string;
  slidePaths?: string[];
  originalFileName?: string;
  [key: string]: unknown;
};

function isGeneratedPortfolioAsset(value: unknown): value is GeneratedPortfolioAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<GeneratedPortfolioAsset>;
  return (asset.kind === "thumbnail" || asset.kind === "body_image")
    && typeof asset.bucket === "string"
    && typeof asset.path === "string"
    && typeof asset.url === "string"
    && Array.isArray(asset.slideIndexes)
    && asset.slideIndexes.every((index) => Number.isInteger(index) && index >= 0);
}

function renderedPortfolioSlideIndexes(assets: GeneratedPortfolioAsset[]) {
  if (!assets.length || assets.some((asset) => (
    !asset.slideIndexes.length || new Set(asset.slideIndexes).size !== asset.slideIndexes.length
  ))) return null;
  return [...new Set(assets.flatMap((asset) => asset.slideIndexes))]
    .sort((left, right) => left - right);
}

function isPortfolioSlideRedactionProof(value: unknown): value is PortfolioSlideRedactionProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<PortfolioSlideRedactionProof>;
  return Number.isInteger(proof.slideIndex)
    && Number(proof.slideIndex) >= 0
    && Number.isInteger(proof.regionCount)
    && Number(proof.regionCount) >= 0
    && typeof proof.changedPixelRatio === "number"
    && Number.isFinite(proof.changedPixelRatio)
    && proof.changedPixelRatio >= 0
    && typeof proof.sourceHash === "string"
    && typeof proof.redactedHash === "string";
}

function portfolioMockupMetadata(input: {
  review: PortfolioVisualReview;
  assets: GeneratedPortfolioAsset[];
  verification: { verified: boolean; regionCount: number; coverage: number };
}) {
  const bodyAssets = input.assets.filter((asset) => asset.kind === "body_image");
  const selectedSlideIndexes = [...new Set(bodyAssets.flatMap((asset) => asset.slideIndexes))];
  const selected = new Set(selectedSlideIndexes);
  const selectionReasons = (input.review.selection?.selectedSlides || [])
    .filter((slide) => selected.has(slide.slideIndex))
    .map((slide) => `장표 ${slide.slideIndex + 1} · ${slide.totalScore}점 · ${slide.reason}`)
    .slice(0, 30);
  return {
    mode: input.assets[0]?.mockupMode || (bodyAssets.length === 4 ? "short_psd" : "six_grid"),
    bodyBoardCount: bodyAssets.length,
    aspectClass: input.assets[0]?.aspectClass || "unknown",
    selectedSlideIndexes,
    selectionReasons,
    redactionRegionCount: input.verification.regionCount,
    redactionCoverage: input.verification.coverage,
    redactionStatus: input.verification.verified ? "verified" as const : "blocked" as const,
  };
}

function hasBlockingPortfolioDraftIssue(issues: string[]) {
  return issues.some((issue) =>
    /짧음|김|H2|FAQ|미만|연속|설명 문단|내부 슬라이드/.test(issue));
}

type CompletedPortfolioMockup = {
  sourceFingerprint: string;
  portfolioRuleVersion: string;
  portfolioGenerationId: string;
  review: PortfolioVisualReview;
  assets: GeneratedPortfolioAsset[];
  redactionMode: string;
  confidentialRegions: SensitiveRegion[];
  portfolioMockup: ReturnType<typeof portfolioMockupMetadata>;
  redactionProof: PortfolioRedactionProof;
  localRedactionManifest: LocalRedactionManifest;
  legacyDraftProgress?: PortfolioDraftProgress;
};

export const PORTFOLIO_REDACTION_UPGRADE_ERROR_CODE = "PORTFOLIO_REDACTION_UPGRADE_REQUIRED";

function completedPortfolioMockup(value: unknown): CompletedPortfolioMockup | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const review = result.visualReview as PortfolioVisualReview | undefined;
  const assets = Array.isArray(result.assets)
    ? result.assets.filter(isGeneratedPortfolioAsset)
    : [];
  const portfolioMockup = result.portfolioMockup;
  const renderedSlideIndexes = renderedPortfolioSlideIndexes(assets);
  const rawManifest = result.localRedactionManifest;
  const manifestSlideCount = rawManifest && typeof rawManifest === "object" && !Array.isArray(rawManifest)
    ? Number((rawManifest as { slideCount?: unknown }).slideCount)
    : 0;
  const localRedactionManifest = parseLocalRedactionManifest(rawManifest, manifestSlideCount);
  if (
    typeof result.sourceFingerprint !== "string"
    || !result.sourceFingerprint
    || typeof result.portfolioRuleVersion !== "string"
    || typeof result.portfolioGenerationId !== "string"
    || !result.portfolioGenerationId
    || !review?.suitable
    || assets.length < 2
    || !renderedSlideIndexes?.length
    || !portfolioMockup
    || typeof portfolioMockup !== "object"
    || !localRedactionManifest
    || !isVerifiedPortfolioRedactionProof(
      result.redactionProof,
      result.sourceFingerprint,
      renderedSlideIndexes,
      localRedactionManifest,
    )
  ) return null;
  return {
    sourceFingerprint: result.sourceFingerprint,
    portfolioRuleVersion: result.portfolioRuleVersion,
    portfolioGenerationId: result.portfolioGenerationId,
    review,
    assets,
    redactionMode: typeof result.redactionMode === "string" ? result.redactionMode : "confidential",
    confidentialRegions: Array.isArray(result.confidentialRegions)
      ? result.confidentialRegions as SensitiveRegion[]
      : [],
    portfolioMockup: portfolioMockup as ReturnType<typeof portfolioMockupMetadata>,
    redactionProof: result.redactionProof as PortfolioRedactionProof,
    localRedactionManifest,
    legacyDraftProgress: result.portfolioDraftProgress
      && typeof result.portfolioDraftProgress === "object"
      ? result.portfolioDraftProgress as PortfolioDraftProgress
      : undefined,
  };
}

type PortfolioTerminalHoldInput = {
  candidateId: string;
  workItemId: string;
  sourceJobId: string;
  code: string;
  message: string;
  stage: string;
  summary: string;
  heldAt: string;
  owner: PortfolioTerminalHoldOwner;
};

function terminalDependentMatchesOwner(
  metadataValue: unknown,
  owner: PortfolioTerminalHoldOwner,
) {
  const metadata = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)
    ? metadataValue as Record<string, unknown>
    : {};
  const hasGenerationToken = typeof metadata.portfolioGenerationId === "string"
    || typeof metadata.portfolioConversionGenerationId === "string";
  return hasGenerationToken
    ? ownsPortfolioTerminalHold(metadata, owner)
    : true;
}

const PROTECTED_PORTFOLIO_STATUSES = new Set([
  "published",
  "scheduled",
  "naver_ready",
  "approved",
  "review_required",
]);

async function updatePortfolioWorkItemIfOwned(
  admin: ReturnType<typeof contentAdmin>,
  input: {
    workItemId: string;
    owns: (metadata: unknown) => boolean;
    requiredMetadata?: Record<string, string>;
    values: (metadata: Record<string, unknown>) => Record<string, unknown>;
  },
) {
  const { data: workItem, error: readError } = await admin.from("content_work_items")
    .select("id,status,metadata,updated_at")
    .eq("id", input.workItemId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!workItem
    || PROTECTED_PORTFOLIO_STATUSES.has(workItem.status)
    || !input.owns(workItem.metadata)) return false;
  const metadata = workItem.metadata && typeof workItem.metadata === "object"
    ? workItem.metadata as Record<string, unknown>
    : {};
  let update = admin.from("content_work_items")
    .update(input.values(metadata))
    .eq("id", workItem.id)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at);
  if (input.requiredMetadata && Object.keys(input.requiredMetadata).length) {
    update = update.contains("metadata", input.requiredMetadata);
  }
  const { data: updated, error: updateError } = await update.select("id").maybeSingle();
  if (updateError) throw new Error(updateError.message);
  return Boolean(updated);
}

async function holdPortfolioTerminalDependents(
  admin: ReturnType<typeof contentAdmin>,
  input: PortfolioTerminalHoldInput,
) {
  const [sourceJobResult, draftResult, candidateResult, workItemResult] = await Promise.all([
    admin.from("content_jobs")
      .select("id,status,last_error_code,updated_at")
      .eq("id", input.sourceJobId)
      .maybeSingle(),
    admin.from("content_jobs")
      .select("id,status,payload,updated_at")
      .eq("candidate_id", input.candidateId)
      .eq("job_type", "draft")
      .maybeSingle(),
    admin.from("portfolio_candidates")
      .select("id,status,metadata,updated_at")
      .eq("id", input.candidateId)
      .maybeSingle(),
    admin.from("content_work_items")
      .select("id,status,metadata,updated_at")
      .eq("id", input.workItemId)
      .maybeSingle(),
  ]);
  const readError = sourceJobResult.error
    || draftResult.error
    || candidateResult.error
    || workItemResult.error;
  if (readError) throw new Error(readError.message);

  const sourceJob = sourceJobResult.data;
  const workItem = workItemResult.data;
  const sourceStillTerminal = sourceJob?.status === "on_hold"
    && sourceJob.last_error_code === input.code
    && sourceJob.updated_at === input.heldAt;
  if (!sourceStillTerminal
    || !workItem
    || !ownsPortfolioTerminalHold(workItem.metadata, input.owner)) {
    return { stateConflict: true };
  }

  const protectedStatuses = new Set(["published", "scheduled", "naver_ready", "approved", "review_required"]);
  if (protectedStatuses.has(workItem.status)) return { stateConflict: false };
  const metadata = workItem.metadata && typeof workItem.metadata === "object"
    ? workItem.metadata as Record<string, unknown>
    : {};
  const { data: heldWorkItem, error: workItemHoldError } = await admin
    .from("content_work_items")
    .update({
    status: "on_hold",
    summary: input.summary,
    review_note: input.message,
    metadata: {
      ...metadata,
      portfolioStage: input.stage,
      portfolioTerminalErrorCode: input.code,
      portfolioTerminalHeldAt: input.heldAt,
    },
    updated_at: input.heldAt,
  }).eq("id", workItem.id)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at)
    .select("id")
    .maybeSingle();
  if (workItemHoldError) throw new Error(workItemHoldError.message);
  if (!heldWorkItem) return { stateConflict: true };

  const terminalOwnerStillCurrent = async () => {
    const [source, heldItem] = await Promise.all([
      admin.from("content_jobs")
        .select("id")
        .eq("id", input.sourceJobId)
        .eq("status", "on_hold")
        .eq("last_error_code", input.code)
        .eq("updated_at", input.heldAt)
        .maybeSingle(),
      admin.from("content_work_items")
        .select("id")
        .eq("id", input.workItemId)
        .eq("status", "on_hold")
        .eq("updated_at", input.heldAt)
        .maybeSingle(),
    ]);
    const ownershipError = source.error || heldItem.error;
    if (ownershipError) throw new Error(ownershipError.message);
    return Boolean(source.data && heldItem.data);
  };

  let stateConflict = false;
  const draft = draftResult.data;
  if (draft
    && draft.id !== input.sourceJobId
    && ["queued", "failed", "on_hold"].includes(draft.status)) {
    if (!terminalDependentMatchesOwner(draft.payload, input.owner)
      || !await terminalOwnerStillCurrent()) {
      stateConflict = true;
    } else {
      const { data, error } = await admin.from("content_jobs").update({
        status: "on_hold",
        next_retry_at: null,
        last_error_code: input.code,
        error_message: input.message,
        updated_at: input.heldAt,
      }).eq("id", draft.id)
        .eq("status", draft.status)
        .eq("updated_at", draft.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) stateConflict = true;
    }
  }

  const candidate = candidateResult.data;
  if (candidate && candidate.status !== "excluded") {
    if (!terminalDependentMatchesOwner(candidate.metadata, input.owner)
      || !await terminalOwnerStillCurrent()) {
      stateConflict = true;
    } else {
      const { data, error } = await admin.from("portfolio_candidates").update({
        status: "on_hold",
        updated_at: input.heldAt,
      }).eq("id", candidate.id)
        .eq("status", candidate.status)
        .eq("updated_at", candidate.updated_at)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) stateConflict = true;
    }
  }

  return { stateConflict };
}

async function holdDraftForRedactionUpgrade(
  admin: ReturnType<typeof contentAdmin>,
  input: {
    job: {
      id: string;
      candidate_id: string;
      work_item_id: string;
      status: string;
      updated_at: string;
      result: unknown;
    };
  },
) {
  const heldAt = new Date().toISOString();
  const message = "현재 완료된 디자인은 선택적 기밀 가림 v2 증명을 통과하지 못했습니다. 기존 이미지와 글은 유지됩니다. 자동 재생성하지 않으므로 관리자에서 이 작업물만 다시 만들기를 실행해 주세요.";
  const previousResult = input.job.result && typeof input.job.result === "object"
    ? input.job.result as Record<string, unknown>
    : {};
  const { data: heldDraft, error: holdError } = await admin.from("content_jobs").update({
    status: "on_hold",
    next_retry_at: null,
    last_error_code: PORTFOLIO_REDACTION_UPGRADE_ERROR_CODE,
    error_message: message,
    completed_at: heldAt,
    result: {
      ...previousResult,
      terminalReason: PORTFOLIO_REDACTION_UPGRADE_ERROR_CODE,
    },
    updated_at: heldAt,
  }).eq("id", input.job.id)
    .eq("status", input.job.status)
    .eq("updated_at", input.job.updated_at)
    .select("id")
    .maybeSingle();
  if (holdError) throw new Error(holdError.message);
  if (!heldDraft) return false;

  await holdPortfolioTerminalDependents(admin, {
    candidateId: input.job.candidate_id,
    workItemId: input.job.work_item_id,
    sourceJobId: input.job.id,
    code: PORTFOLIO_REDACTION_UPGRADE_ERROR_CODE,
    message,
    stage: "redaction_upgrade_required",
    summary: "기존 디자인은 유지했습니다. 선택적 기밀 가림 규칙으로 다시 만들 작업물을 관리자가 하나씩 선택해 주세요.",
    heldAt,
    owner: {},
  });
  return true;
}

async function markOwnedGenerationOnHold(
  admin: ReturnType<typeof contentAdmin>,
  input: {
    workItemId: string;
    generationId: string;
    sourceFingerprint: string;
    ruleVersion: string;
    message: string;
    stage: string;
    failedAt: string;
  },
) {
  const { data: workItem, error: readError } = await admin.from("content_work_items")
    .select("id,status,metadata,updated_at")
    .eq("id", input.workItemId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!workItem || !ownsPortfolioGeneration(
    workItem.metadata,
    input.generationId,
    input.sourceFingerprint,
    input.ruleVersion,
  )) return false;
  const protectedStatuses = new Set(["published", "scheduled", "naver_ready", "approved", "review_required"]);
  if (protectedStatuses.has(workItem.status)) return false;
  const metadata = workItem.metadata as Record<string, unknown>;
  const { data: heldWorkItem, error: holdError } = await admin.from("content_work_items").update({
    status: "on_hold",
    review_note: input.message,
    metadata: {
      ...metadata,
      portfolioStage: input.stage,
      portfolioPostCommitError: input.message,
      portfolioPostCommitFailedAt: input.failedAt,
    },
    updated_at: input.failedAt,
  }).eq("id", workItem.id)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at)
    .select("id")
    .maybeSingle();
  if (holdError) throw new Error(holdError.message);
  return Boolean(heldWorkItem);
}

async function rejectCandidate(input: {
  jobId: string;
  claimStartedAt: string;
  candidateId: string;
  workItemId: string;
  review: PortfolioVisualReview;
  owner: PortfolioTerminalHoldOwner;
}) {
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const reasons = input.review.rejectionReasons.length
    ? input.review.rejectionReasons
    : ["실제 페이지의 구성과 완성도가 포트폴리오 기준을 충족하지 않았습니다."];
  const { data: rejectedJob, error: rejectedJobError } = await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    result: {
      visualReview: input.review,
      rejected: true,
      ...(input.owner.conversionGenerationId
        ? { portfolioConversionGenerationId: input.owner.conversionGenerationId }
        : {}),
    },
    error_message: null,
    updated_at: now,
  }).eq("id", input.jobId)
    .eq("status", "running")
    .eq("started_at", input.claimStartedAt)
    .select("id")
    .maybeSingle();
  if (rejectedJobError) throw new Error(rejectedJobError.message);
  if (!rejectedJob) throw new PortfolioClaimLost();

  const [draftResult, candidateResult, workItemResult] = await Promise.all([
    admin.from("content_jobs")
      .select("id,status,payload,updated_at")
      .eq("candidate_id", input.candidateId)
      .eq("job_type", "draft")
      .maybeSingle(),
    admin.from("portfolio_candidates")
      .select("id,status,metadata,updated_at")
      .eq("id", input.candidateId)
      .maybeSingle(),
    admin.from("content_work_items")
      .select("id,status,metadata,updated_at")
      .eq("id", input.workItemId)
      .maybeSingle(),
  ]);
  const snapshotError = draftResult.error || candidateResult.error || workItemResult.error;
  if (snapshotError) throw new Error(snapshotError.message);
  const workItem = workItemResult.data;
  const protectedStatuses = new Set(["published", "scheduled", "naver_ready", "approved", "review_required"]);
  if (!workItem
    || protectedStatuses.has(workItem.status)
    || !ownsPortfolioTerminalHold(workItem.metadata, input.owner)) return;

  const { data: heldWorkItem, error: workItemError } = await admin.from("content_work_items").update({
    status: "on_hold",
    summary: "실제 페이지를 확인한 결과 포트폴리오로 사용하지 않기로 자동 제외했습니다.",
    review_note: `시각 판정 제외: ${reasons.join(" · ")}`,
    metadata: {
      ...(workItem.metadata || {}),
      portfolioReview: input.review,
    },
    updated_at: now,
  }).eq("id", input.workItemId)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at)
    .select("id")
    .maybeSingle();
  if (workItemError) throw new Error(workItemError.message);
  if (!heldWorkItem) return;

  const rejectionOwnerStillCurrent = async () => {
    const [source, heldItem] = await Promise.all([
      admin.from("content_jobs")
        .select("id")
        .eq("id", input.jobId)
        .eq("status", "completed")
        .eq("completed_at", now)
        .eq("updated_at", now)
        .contains("result", { rejected: true })
        .maybeSingle(),
      admin.from("content_work_items")
        .select("id")
        .eq("id", input.workItemId)
        .eq("status", "on_hold")
        .eq("updated_at", now)
        .maybeSingle(),
    ]);
    const ownerError = source.error || heldItem.error;
    if (ownerError) throw new Error(ownerError.message);
    return Boolean(source.data && heldItem.data);
  };

  const draft = draftResult.data;
  if (draft
    && ["queued", "failed", "on_hold"].includes(draft.status)
    && terminalDependentMatchesOwner(draft.payload, input.owner)
    && await rejectionOwnerStillCurrent()) {
    const { error } = await admin.from("content_jobs").update({
      status: "on_hold",
      error_message: "시각 적합성 판정에서 제외됨",
      updated_at: now,
    }).eq("id", draft.id)
      .eq("status", draft.status)
      .eq("updated_at", draft.updated_at);
    if (error) throw new Error(error.message);
  }

  const candidate = candidateResult.data;
  if (candidate
    && candidate.status !== "excluded"
    && terminalDependentMatchesOwner(candidate.metadata, input.owner)
    && await rejectionOwnerStillCurrent()) {
    const { error } = await admin.from("portfolio_candidates").update({
      status: "excluded",
      exclusion_reasons: reasons,
      metadata: {
        ...(candidate.metadata || {}),
        visualReview: input.review,
        rejectedAt: now,
      },
      updated_at: now,
    }).eq("id", candidate.id)
      .eq("status", candidate.status)
      .eq("updated_at", candidate.updated_at);
    if (error) throw new Error(error.message);
  }
}

export async function processNextPortfolioMockup(candidateId?: string) {
  const admin = contentAdmin();
  const executionDeadlineAt = Date.now() + 225_000;
  const shouldYield = () => Date.now() >= executionDeadlineAt - 65_000;
  const staleBefore = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const staleAt = new Date().toISOString();
  let staleQuery = admin.from("content_jobs").update({
    status: "failed",
    attempts: 0,
    next_retry_at: null,
    error_message: "AI_STEP_TIMEOUT: 이전 실행이 제한 시간 안에 끝나지 않아 체크포인트부터 다시 시작합니다.",
    completed_at: staleAt,
    updated_at: staleAt,
  }).eq("job_type", "mockup").eq("status", "running").lt("updated_at", staleBefore);
  if (candidateId) staleQuery = staleQuery.eq("candidate_id", candidateId);
  const { error: staleError } = await staleQuery;
  if (staleError) throw new Error(staleError.message);

  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,status,result,payload,attempts,max_attempts,error_message,next_retry_at")
    .eq("job_type", "mockup")
    .in("status", ["queued", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(1);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);
  const job = jobs?.[0];
  if (!job) return null;
  let attempts = Number(job.attempts || 0);
  let result = (job.result || {}) as Record<string, unknown>;
  const recoverableJsonFailure = /Unexpected non-whitespace|AI JSON|JSON 객체|AI_STEP_TIMEOUT/i
    .test(String(job.error_message || ""));
  const recoveryField = /AI_STEP_TIMEOUT/i.test(String(job.error_message || ""))
    ? "timeoutRecoveryAttemptedAt"
    : "jsonFormatRecoveryAttemptedAt";
  if (attempts >= Number(job.max_attempts || 3)) {
    if (!recoverableJsonFailure || result[recoveryField]) return null;
    const recoveryAt = new Date().toISOString();
    result = { ...result, [recoveryField]: recoveryAt };
    const { error: recoveryError } = await admin.from("content_jobs").update({
      attempts: 0,
      result,
      error_message: null,
      updated_at: recoveryAt,
    }).eq("id", job.id);
    if (recoveryError) throw new Error(recoveryError.message);
    attempts = 0;
  }

  const now = new Date().toISOString();
  const { data: claimedJob, error: claimJobError } = await admin.from("content_jobs").update({
    status: "running",
    attempts: attempts + 1,
    started_at: now,
    completed_at: null,
    error_message: null,
    next_retry_at: null,
    updated_at: now,
  }).eq("id", job.id)
    .eq("status", job.status)
    .eq("attempts", attempts)
    .select("id")
    .maybeSingle();
  if (claimJobError) throw new Error(claimJobError.message);
  if (!claimedJob) return null;
  const claimStartedAt = now;
  const claimedPayload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  const terminalOwner: PortfolioTerminalHoldOwner = {
    conversionGenerationId: typeof claimedPayload.portfolioConversionGenerationId === "string"
      ? claimedPayload.portfolioConversionGenerationId
      : null,
  };
  const terminalRequiredMetadata = terminalOwner.conversionGenerationId
    ? { portfolioConversionGenerationId: terminalOwner.conversionGenerationId }
    : undefined;
  let committedJobAt: string | null = null;
  let committedGeneration: { id: string; sourceFingerprint: string } | null = null;
  let pendingInsertedAssetIds: string[] = [];

  const cleanupPendingInsertedAssets = async () => {
    if (!pendingInsertedAssetIds.length) return;
    const ids = [...pendingInsertedAssetIds];
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await admin.from("content_review_assets")
        .delete()
        .in("id", ids);
      if (!error) {
        pendingInsertedAssetIds = [];
        return;
      }
      lastError = error.message;
    }
    throw new Error(lastError || "새 디자인 자산 정리에 실패했습니다.");
  };

  const checkpoint = async (values: Record<string, unknown>) => {
    result = { ...result, ...values };
    const { data: checkpointedJob, error } = await admin.from("content_jobs").update({
      result,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!checkpointedJob) throw new PortfolioClaimLost();
  };

  const assertClaim = async () => {
    const { data, error } = await admin.from("content_jobs")
      .select("id")
      .eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new PortfolioClaimLost();
  };

  try {
    const { data: conversion, error: conversionError } = await admin.from("content_jobs")
      .select("result,updated_at")
      .eq("candidate_id", job.candidate_id)
      .eq("job_type", "convert")
      .eq("status", "completed")
      .limit(1)
      .single();
    if (conversionError) throw new Error(conversionError.message);
    const conversionResult = (conversion.result || {}) as JobResult;
    const payload = (job.payload || {}) as JobResult;
    const bucket = String(conversionResult.bucket || payload.bucket || "");
    const slidePaths = (conversionResult.slidePaths || payload.slidePaths || []) as string[];
    if (!bucket) {
      throw new Error("시각 판정에 필요한 렌더링 저장 위치가 없습니다.");
    }
    if (slidePaths.length < 5) {
      const review = {
        suitable: false,
        confidence: 1,
        documentType: "페이지 수 부족",
        industry: "",
        projectTitle: "",
        designSummary: `${slidePaths.length}페이지 문서로 포트폴리오 장면이 충분하지 않습니다.`,
        reasons: [],
        rejectionReasons: ["서로 다른 디자인 장면을 보여주기 위한 최소 5페이지 기준에 미달합니다."],
        slideAssessments: [],
        recommendedSlideIndexes: [],
        sensitiveRegions: [],
      };
      await rejectCandidate({
        jobId: job.id,
        claimStartedAt,
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        review,
        owner: terminalOwner,
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "rejected",
        review,
      };
    }

    const sourceFingerprint = createPortfolioSourceFingerprint({
      bucket,
      slidePaths,
      conversionUpdatedAt: conversion.updated_at,
    });
    const checkpointFields = [
      "visualReview",
      "visualReviewBase",
      "slideAssessmentsProgress",
      "confidentialRegions",
      "confidentialRegionsProgress",
      "confidentialAudits",
      "confidentialAuditsProgress",
      "confidentialRegionsCompletedIndexes",
      "redactionVerification",
      "portfolioAssetsProgress",
      "portfolioDraftProgress",
    ];
    const hasReusableCheckpoint = checkpointFields.some((field) => result[field] !== undefined);
    if (hasReusableCheckpoint && result.sourceFingerprint !== sourceFingerprint) {
      result = {
        rebuildRequestedAt: result.rebuildRequestedAt,
        jsonFormatRecoveryAttemptedAt: result.jsonFormatRecoveryAttemptedAt,
        timeoutRecoveryAttemptedAt: result.timeoutRecoveryAttemptedAt,
        sourceCheckpointResetAt: new Date().toISOString(),
      };
    }
    await checkpoint({ sourceFingerprint });

    const localManifest = parseLocalRedactionManifest(
      conversionResult.localRedactionManifest || payload.localRedactionManifest,
      slidePaths.length,
    );
    if (!localManifest) {
      if (isPdfPortfolioSource(conversionResult)) {
        throw new PortfolioPdfLocalRedactionUnsupported();
      }
      throw new Error("LOCAL_REDACTION_MANIFEST_REQUIRED: 사무실 PC의 로컬 기밀 좌표가 없어 디자인을 안전하게 만들 수 없습니다. PowerPoint 원본을 최신 워커로 다시 변환해 주세요.");
    }

    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("metadata,project_name,updated_at")
      .eq("id", job.candidate_id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    const cachedReview = result.visualReview as PortfolioVisualReview | undefined;
    const cachedReviewComplete = Boolean(
      cachedReview
      && typeof cachedReview.suitable === "boolean"
      && (!cachedReview.suitable
        || (cachedReview.selection
          && cachedReview.slideAssessments?.length >= slidePaths.length)),
    );
    const review = cachedReviewComplete
      ? cachedReview as PortfolioVisualReview
      : await createLocalPortfolioReview({
        bucket,
        slidePaths,
        sourceHint: `${candidate.project_name || ""} ${conversionResult.originalFileName || ""}`,
      });
    await checkpoint({
      visualReview: review,
      slideAssessmentsProgress: review.slideAssessments,
      visualReviewCompletedAt: new Date().toISOString(),
      visualReviewMethod: "local_image_metrics_v1",
    });
    if (!review.suitable || review.confidence < 0.72 || review.recommendedSlideIndexes.length < 5) {
      await rejectCandidate({
        jobId: job.id,
        claimStartedAt,
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        review,
        owner: terminalOwner,
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "rejected",
        review,
      };
    }

    const mockupPlan = portfolioMockupIndexes(slidePaths.length, review, localManifest);
    const confidentialRegions = localRedactionRegions(localManifest, mockupPlan.indexes);
    const redactionVerification = verifyLocalRedactionSelection(localManifest, mockupPlan.indexes);
    const minimumSelectedSlides = mockupPlan.mode === "long" ? 18 : 5;
    if (!redactionVerification.verified
      || mockupPlan.selectedIndexes.length < minimumSelectedSlides) {
      throw new PortfolioRedactionSelectionBlocked(
        `안전한 장표 ${mockupPlan.selectedIndexes.length}개, 필요 장표 ${minimumSelectedSlides}개`,
      );
    }
    await checkpoint({
      confidentialRegions,
      confidentialRegionsProgress: confidentialRegions,
      confidentialRegionsCompletedIndexes: mockupPlan.indexes,
      redactionVerification,
      redactionMethod: localManifest.method,
      localRedactionManifest: localManifest,
      confidentialRegionsCompletedAt: new Date().toISOString(),
    });

    const cachedAssets = Array.isArray(result.portfolioAssetsProgress)
      ? result.portfolioAssetsProgress.filter(isGeneratedPortfolioAsset)
      : [];
    const cachedRenderedIndexes = renderedPortfolioSlideIndexes(cachedAssets);
    let redactionProof = cachedRenderedIndexes && isVerifiedPortfolioRedactionProof(
      result.redactionProof,
      sourceFingerprint,
      cachedRenderedIndexes,
      localManifest,
    ) ? result.redactionProof as PortfolioRedactionProof : null;
    let assets = cachedAssets.length >= 4 && redactionProof ? cachedAssets : [];
    if (!assets.length || !redactionProof) {
      yieldPortfolioCheckpointIfNeeded(shouldYield);
      await assertClaim();
      let slideProof = Array.isArray(result.redactionSlideProofProgress)
        ? result.redactionSlideProofProgress.filter(isPortfolioSlideRedactionProof)
        : [];
      assets = await createPortfolioMockups({
        candidateId: job.candidate_id,
        bucket,
        slidePaths,
        review,
        localRedactionManifest: localManifest,
        onRedactionProof: async (proof) => {
          slideProof = proof;
          await checkpoint({ redactionSlideProofProgress: proof });
        },
      });
      const renderedIndexes = renderedPortfolioSlideIndexes(assets);
      if (!renderedIndexes?.length) {
        throw new Error("대표 썸네일과 본문 목업의 원본 장표 기록이 비어 있어 디자인 저장을 중단했습니다.");
      }
      const renderedIndexSet = new Set(renderedIndexes);
      redactionProof = createLocalRedactionProof({
        manifest: localManifest,
        sourceFingerprint,
        selectedSlideIndexes: renderedIndexes,
        slides: slideProof.filter((proof) => renderedIndexSet.has(proof.slideIndex)),
      });
      await checkpoint({
        portfolioAssetsProgress: assets,
        redactionProof,
        portfolioAssetsCompletedAt: new Date().toISOString(),
      });
    }
    if (!redactionProof) {
      throw new Error("로컬 기밀 블러 증명을 만들지 못해 디자인 저장을 중단했습니다.");
    }
    const mockupMetadata = portfolioMockupMetadata({
      review,
      assets,
      verification: redactionVerification,
    });
    const completedAt = new Date().toISOString();
    const generationId = createPortfolioGenerationId({
      jobId: job.id,
      completedAt,
      sourceFingerprint,
    });
    const { data: workItem, error: workItemError } = await admin.from("content_work_items")
      .select("metadata,status,updated_at")
      .eq("id", job.work_item_id)
      .single();
    if (workItemError) throw new Error(workItemError.message);
    const workItemMetadata = { ...(workItem?.metadata || {}) } as Record<string, unknown>;
    for (const key of ["generated", "validation", "generatedAt", "draftCompletedAt"]) {
      delete workItemMetadata[key];
    }

    // The job CAS is the durable winner election. No candidate, work-item, or
    // review asset is made visible until this exact runner owns completion.
    await assertClaim();
    const { data: completedJob, error: completedJobError } = await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      next_retry_at: null,
      last_error_code: null,
      result: {
        sourceFingerprint,
        portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
        portfolioGenerationId: generationId,
        visualReview: review,
        assets,
        redactionMode: "confidential",
        confidentialRegions,
        redactionProof,
        localRedactionManifest: localManifest,
        portfolioMockup: mockupMetadata,
        ...(result.portfolioDraftProgress && typeof result.portfolioDraftProgress === "object"
          ? { portfolioDraftProgress: result.portfolioDraftProgress }
          : {}),
      },
      updated_at: completedAt,
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (completedJobError) throw new Error(completedJobError.message);
    if (!completedJob) throw new PortfolioClaimLost();
    committedJobAt = completedAt;
    committedGeneration = { id: generationId, sourceFingerprint };

    // Bind the visible result to the work-item snapshot that existed while the
    // job was running. A rebuild/source invalidation changes updated_at and
    // therefore prevents a stale runner from publishing its metadata.
    const { data: committedWorkItem, error: workUpdateError } = await admin.from("content_work_items").update({
      summary: "포트폴리오 디자인 목업을 완성했습니다. Gemini 글쓰기 작업은 별도 대기열에서 이어서 처리합니다.",
      status: "creating",
      source_label: "NAVER WORKS 실제 프로젝트 · 로컬 시각 분석",
      review_note: "디자인 목업은 저장되었습니다. 본문 초안 생성을 이어서 진행합니다.",
      metadata: {
        ...workItemMetadata,
        portfolioReview: review,
        portfolioAssets: assets,
        portfolioSourceFingerprint: sourceFingerprint,
        portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
        portfolioGenerationId: generationId,
        redactionMode: "confidential",
        confidentialRegions,
        redactionProof,
        portfolioMockup: mockupMetadata,
        portfolioStage: "design_completed",
        designCompletedAt: completedAt,
      },
      updated_at: completedAt,
    }).eq("id", job.work_item_id)
      .eq("status", workItem.status)
      .eq("updated_at", workItem.updated_at)
      .select("id")
      .maybeSingle();
    if (workUpdateError) throw new Error(workUpdateError.message);
    if (!committedWorkItem) throw new PortfolioClaimLost();

    const { data: committedCandidate, error: candidateUpdateError } = await admin
      .from("portfolio_candidates")
      .update({
        status: "processed",
        privacy_risk: confidentialRegions.length ? "medium" : "low",
        quality_score: Math.round(review.confidence * 100),
        selection_reasons: review.reasons,
        metadata: {
          ...(candidate.metadata || {}),
          visualReview: review,
          mockupCount: assets.length,
          redactionMode: "confidential",
          confidentialRegions,
          redactionProof,
          portfolioMockup: mockupMetadata,
          portfolioGenerationId: generationId,
          designCompletedAt: completedAt,
        },
        updated_at: completedAt,
      })
      .eq("id", job.candidate_id)
      .eq("updated_at", candidate.updated_at)
      .select("id")
      .maybeSingle();
    if (candidateUpdateError) throw new Error(candidateUpdateError.message);
    // Candidate metadata is a derived summary. A concurrent scanner update may
    // win this CAS; the work-item generation check below remains authoritative.
    void committedCandidate;

    const assertGenerationOwnership = async () => {
      const { data: ownedWorkItem, error: ownershipError } = await admin
        .from("content_work_items")
        .select("id,metadata")
        .eq("id", job.work_item_id)
        .maybeSingle();
      if (ownershipError) throw new Error(ownershipError.message);
      if (!ownedWorkItem || !ownsPortfolioGeneration(
        ownedWorkItem.metadata,
        generationId,
        sourceFingerprint,
        PORTFOLIO_RULE_VERSION,
      )) throw new PortfolioClaimLost();
    };

    await assertGenerationOwnership();
    const { data: previousAssets, error: previousAssetsError } = await admin
      .from("content_review_assets")
      .select("id")
      .eq("work_item_id", job.work_item_id);
    if (previousAssetsError) throw new Error(previousAssetsError.message);
    await assertGenerationOwnership();
    const { data: insertedAssets, error: assetsError } = await admin.from("content_review_assets").insert(
      assets.map((asset, index) => ({
        work_item_id: job.work_item_id,
        asset_type: asset.kind,
        public_url: asset.url,
        sort_order: index,
        approved: false,
        review_note: `${asset.caption} · 원본 슬라이드 ${asset.slideIndexes.map((value) => value + 1).join(", ")}`,
      })),
    ).select("id");
    if (assetsError) throw new Error(assetsError.message);
    pendingInsertedAssetIds = (insertedAssets || []).map((asset) => asset.id);
    const insertedAssetIds = pendingInsertedAssetIds;
    if (insertedAssetIds.length !== assets.length) {
      await cleanupPendingInsertedAssets();
      throw new Error("새 디자인 자산의 세대 소유권을 확인하지 못했습니다.");
    }
    try {
      await assertGenerationOwnership();
    } catch (ownershipError) {
      await cleanupPendingInsertedAssets();
      throw ownershipError;
    }
    const previousAssetIds = (previousAssets || []).map((asset) => asset.id);
    if (previousAssetIds.length) {
      const { error: deleteAssetsError } = await admin.from("content_review_assets")
        .delete()
        .in("id", previousAssetIds);
      if (deleteAssetsError) throw new Error(deleteAssetsError.message);
    }

    const legacyDraftProgress = result.portfolioDraftProgress
      && typeof result.portfolioDraftProgress === "object"
      ? result.portfolioDraftProgress as PortfolioDraftProgress
      : undefined;
    await assertGenerationOwnership();
    const { data: pendingDraft, error: pendingDraftError } = await admin.from("content_jobs")
      .select("id,status,payload,updated_at")
      .eq("candidate_id", job.candidate_id)
      .eq("job_type", "draft")
      .in("status", ["on_hold", "failed"])
      .maybeSingle();
    if (pendingDraftError) throw new Error(pendingDraftError.message);
    if (!pendingDraft) throw new PortfolioClaimLost();
    await assertGenerationOwnership();
    const pendingDraftPayload = pendingDraft.payload && typeof pendingDraft.payload === "object"
      ? pendingDraft.payload as Record<string, unknown>
      : {};
    const { data: queuedDraft, error: draftQueueError } = await admin.from("content_jobs").update({
      status: "queued",
      attempts: 0,
      started_at: null,
      completed_at: null,
      next_retry_at: null,
      last_error_code: null,
      error_message: null,
      payload: {
        ...pendingDraftPayload,
        portfolioGenerationId: generationId,
        portfolioSourceFingerprint: sourceFingerprint,
        portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
      },
      result: legacyDraftProgress ? { portfolioDraftProgress: legacyDraftProgress } : {},
      updated_at: completedAt,
    }).eq("id", pendingDraft.id)
      .eq("status", pendingDraft.status)
      .eq("updated_at", pendingDraft.updated_at)
      .select("id")
      .maybeSingle();
    if (draftQueueError) throw new Error(draftQueueError.message);
    if (!queuedDraft) throw new PortfolioClaimLost();
    await assertGenerationOwnership();
    pendingInsertedAssetIds = [];

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: "creating",
      stage: "design_completed",
      assetCount: assets.length,
    };
  } catch (error) {
    try {
      await cleanupPendingInsertedAssets();
    } catch (cleanupError) {
      if (committedGeneration) {
        const failedAt = new Date().toISOString();
        await markOwnedGenerationOnHold(admin, {
          workItemId: job.work_item_id,
          generationId: committedGeneration.id,
          sourceFingerprint: committedGeneration.sourceFingerprint,
          ruleVersion: PORTFOLIO_RULE_VERSION,
          message: `새 디자인 자산 정리 보류: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          stage: "design_asset_cleanup_failed",
          failedAt,
        });
      }
      throw cleanupError;
    }
    if (error instanceof PortfolioClaimLost) {
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "creating",
        claimLost: true,
      };
    }
    if (committedJobAt) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "포트폴리오 디자인 결과 저장 실패";
      const { error: completionNoteError } = await admin.from("content_jobs").update({
        error_message: message,
        updated_at: failedAt,
      }).eq("id", job.id)
        .eq("status", "completed")
        .eq("completed_at", committedJobAt);
      if (completionNoteError) throw new Error(completionNoteError.message);
      if (committedGeneration) {
        await markOwnedGenerationOnHold(admin, {
          workItemId: job.work_item_id,
          generationId: committedGeneration.id,
          sourceFingerprint: committedGeneration.sourceFingerprint,
          ruleVersion: PORTFOLIO_RULE_VERSION,
          message: `디자인 결과 저장 보류: ${message}`,
          stage: "design_side_effect_failed",
          failedAt,
        });
      }
      throw error;
    }
    if (error instanceof PortfolioRedactionSelectionBlocked) {
      const heldAt = new Date().toISOString();
      const { data: heldJob, error: holdError } = await admin.from("content_jobs").update({
        status: "on_hold",
        next_retry_at: null,
        last_error_code: PORTFOLIO_REDACTION_SELECTION_ERROR_CODE,
        error_message: error.message,
        completed_at: heldAt,
        result: {
          ...result,
          terminalReason: PORTFOLIO_REDACTION_SELECTION_ERROR_CODE,
        },
        updated_at: heldAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (holdError) throw new Error(holdError.message);
      if (!heldJob) return null;
      const dependentHold = await holdPortfolioTerminalDependents(admin, {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        sourceJobId: job.id,
        code: PORTFOLIO_REDACTION_SELECTION_ERROR_CODE,
        message: error.message,
        stage: "redaction_selection_blocked",
        summary: "기밀 블러 범위가 과대한 장표를 제외한 뒤 디자인에 필요한 장표가 부족해 보류했습니다.",
        heldAt,
        owner: terminalOwner,
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "on_hold",
        stage: "redaction_selection_blocked",
        errorCode: PORTFOLIO_REDACTION_SELECTION_ERROR_CODE,
        ...(dependentHold.stateConflict ? { stateChangedDuringHold: true } : {}),
      };
    }
    if (error instanceof PortfolioPdfLocalRedactionUnsupported) {
      const heldAt = new Date().toISOString();
      const { data: heldJob, error: holdError } = await admin.from("content_jobs").update({
        status: "on_hold",
        next_retry_at: null,
        last_error_code: PDF_LOCAL_REDACTION_ERROR_CODE,
        error_message: error.message,
        completed_at: heldAt,
        result: {
          ...result,
          terminalReason: PDF_LOCAL_REDACTION_ERROR_CODE,
        },
        updated_at: heldAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (holdError) throw new Error(holdError.message);
      if (!heldJob) return null;
      const dependentHold = await holdPortfolioTerminalDependents(admin, {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        sourceJobId: job.id,
        code: PDF_LOCAL_REDACTION_ERROR_CODE,
        message: error.message,
        stage: "pdf_redaction_unsupported",
        summary: "PDF 원본은 안전한 로컬 기밀 좌표를 증명할 수 없어 디자인 생성을 중단했습니다.",
        heldAt,
        owner: terminalOwner,
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "on_hold",
        stage: "pdf_redaction_unsupported",
        errorCode: PDF_LOCAL_REDACTION_ERROR_CODE,
        ...(dependentHold.stateConflict ? { stateChangedDuringHold: true } : {}),
      };
    }
    if (error instanceof PortfolioCheckpointYield) {
      const checkpointedAt = new Date().toISOString();
      const { data: yieldedJob, error: yieldError } = await admin.from("content_jobs").update({
        status: "queued",
        attempts,
        started_at: null,
        completed_at: null,
        error_message: null,
        next_retry_at: null,
        result,
        updated_at: checkpointedAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (yieldError) throw new Error(yieldError.message);
      if (!yieldedJob) return null;
      await updatePortfolioWorkItemIfOwned(admin, {
        workItemId: job.work_item_id,
        owns: (metadata) => ownsPortfolioTerminalHold(metadata, terminalOwner),
        requiredMetadata: terminalRequiredMetadata,
        values: () => ({
          status: "creating",
          summary: "AI 실행 제한 시간 전에 진행 상황을 저장했습니다. 다음 자동 실행에서 이어서 제작합니다.",
          review_note: null,
          updated_at: checkpointedAt,
        }),
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "creating",
        checkpointed: true,
      };
    }
    if (error instanceof GeminiRequestError) {
      const retry = geminiRetryDecision(error, Number(result.retryCount || 0));
      result = { ...result, retryCount: retry.retryCount };
      const retryAt = new Date().toISOString();
      const { data: retriedJob, error: retryUpdateError } = await admin.from("content_jobs").update({
        status: "failed",
        attempts: retry.retryable ? 0 : attempts + 1,
        next_retry_at: retry.nextRetryAt,
        last_error_code: retry.code,
        error_message: error.message,
        completed_at: retryAt,
        result,
        updated_at: retryAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (retryUpdateError) throw new Error(retryUpdateError.message);
      if (!retriedJob) return null;
      await updatePortfolioWorkItemIfOwned(admin, {
        workItemId: job.work_item_id,
        owns: (metadata) => ownsPortfolioTerminalHold(metadata, terminalOwner),
        requiredMetadata: terminalRequiredMetadata,
        values: () => ({
          status: retry.retryable ? "creating" : "on_hold",
          review_note: retry.retryable
            ? `Gemini 일시 오류로 자동 재시도 예정: ${retry.nextRetryAt}`
            : `자동 제작 보류: ${error.message}`,
          updated_at: retryAt,
        }),
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: retry.retryable ? "creating" : "on_hold",
        retry,
      };
    }
    const message = error instanceof Error ? error.message : "포트폴리오 목업·초안 생성 실패";
    const failedAt = new Date().toISOString();
    const { data: failedJob, error: failedJobError } = await admin.from("content_jobs").update({
      status: "failed",
      error_message: message,
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (failedJobError) throw new Error(failedJobError.message);
    if (!failedJob) return null;
    await updatePortfolioWorkItemIfOwned(admin, {
      workItemId: job.work_item_id,
      owns: (metadata) => ownsPortfolioTerminalHold(metadata, terminalOwner),
      requiredMetadata: terminalRequiredMetadata,
      values: () => ({
        status: "on_hold",
        review_note: `자동 제작 보류: ${message}`,
        updated_at: failedAt,
      }),
    });
    throw error;
  }
}

export async function processNextPortfolioDraft(candidateId?: string) {
  const admin = contentAdmin();
  const executionDeadlineAt = Date.now() + 225_000;
  const shouldYield = () => Date.now() >= executionDeadlineAt - 65_000;
  const staleBefore = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const staleAt = new Date().toISOString();
  let staleQuery = admin.from("content_jobs").update({
    status: "failed",
    attempts: 0,
    next_retry_at: null,
    error_message: "AI_STEP_TIMEOUT: 이전 본문 생성 작업이 제한 시간 안에 끝나지 않아 저장된 단계부터 다시 시작합니다.",
    completed_at: staleAt,
    updated_at: staleAt,
  }).eq("job_type", "draft").eq("status", "running").lt("updated_at", staleBefore);
  if (candidateId) staleQuery = staleQuery.eq("candidate_id", candidateId);
  const { error: staleError } = await staleQuery;
  if (staleError) throw new Error(staleError.message);

  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,status,result,payload,attempts,max_attempts,error_message,next_retry_at,created_at,updated_at")
    .eq("job_type", "draft")
    .in("status", ["queued", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(candidateId ? 1 : 12);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);

  let selected: {
    job: NonNullable<typeof jobs>[number];
    mockup: CompletedPortfolioMockup;
  } | null = null;
  for (const pendingJob of jobs || []) {
    if (!pendingJob.candidate_id || !pendingJob.work_item_id) continue;
    let pendingResult = (pendingJob.result || {}) as Record<string, unknown>;
    let pendingAttempts = Number(pendingJob.attempts || 0);
    const recoverableJsonFailure = /Unexpected non-whitespace|AI JSON|JSON 객체|AI_STEP_TIMEOUT/i
      .test(String(pendingJob.error_message || ""));
    const recoveryField = /AI_STEP_TIMEOUT/i.test(String(pendingJob.error_message || ""))
      ? "timeoutRecoveryAttemptedAt"
      : "jsonFormatRecoveryAttemptedAt";
    if (pendingAttempts >= Number(pendingJob.max_attempts || 3)) {
      if (!recoverableJsonFailure || pendingResult[recoveryField]) continue;
      const recoveryAt = new Date().toISOString();
      pendingResult = { ...pendingResult, [recoveryField]: recoveryAt };
      const { error: recoveryError } = await admin.from("content_jobs").update({
        attempts: 0,
        result: pendingResult,
        error_message: null,
        updated_at: recoveryAt,
      }).eq("id", pendingJob.id)
        .eq("status", pendingJob.status)
        .eq("attempts", pendingAttempts);
      if (recoveryError) throw new Error(recoveryError.message);
      pendingAttempts = 0;
      pendingJob.attempts = 0;
      pendingJob.result = pendingResult;
    }
    const { data: mockupJob, error: mockupError } = await admin.from("content_jobs")
      .select("id,result")
      .eq("candidate_id", pendingJob.candidate_id)
      .eq("job_type", "mockup")
      .eq("status", "completed")
      .maybeSingle();
    if (mockupError) throw new Error(mockupError.message);
    const frozenMockup = completedPortfolioMockup(mockupJob?.result);
    if (!frozenMockup) {
      if (mockupJob) {
        await holdDraftForRedactionUpgrade(admin, {
          job: {
            id: pendingJob.id,
            candidate_id: pendingJob.candidate_id,
            work_item_id: pendingJob.work_item_id,
            status: pendingJob.status,
            updated_at: pendingJob.updated_at,
            result: pendingJob.result,
          },
        });
      }
      continue;
    }
    const pendingPayload = pendingJob.payload && typeof pendingJob.payload === "object"
      ? pendingJob.payload as Record<string, unknown>
      : {};
    if (typeof pendingPayload.portfolioGenerationId === "string"
      && pendingPayload.portfolioGenerationId !== frozenMockup.portfolioGenerationId) {
      continue;
    }
    selected = { job: pendingJob, mockup: frozenMockup };
    break;
  }
  if (!selected) return null;

  const { job, mockup } = selected;
  let attempts = Number(job.attempts || 0);
  let result = (job.result || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const { data: claimedJob, error: claimJobError } = await admin.from("content_jobs").update({
    status: "running",
    attempts: attempts + 1,
    started_at: now,
    completed_at: null,
    error_message: null,
    next_retry_at: null,
    updated_at: now,
  }).eq("id", job.id)
    .eq("status", job.status)
    .eq("attempts", attempts)
    .select("id")
    .maybeSingle();
  if (claimJobError) throw new Error(claimJobError.message);
  if (!claimedJob) return null;
  const claimStartedAt = now;
  attempts += 1;
  let committedJobAt: string | null = null;

  const checkpoint = async (values: Record<string, unknown>) => {
    result = {
      ...result,
      sourceFingerprint: mockup.sourceFingerprint,
      portfolioRuleVersion: mockup.portfolioRuleVersion,
      ...values,
    };
    const { data: checkpointedJob, error } = await admin.from("content_jobs").update({
      result,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!checkpointedJob) throw new PortfolioClaimLost();
  };

  const assertClaim = async () => {
    const { data, error } = await admin.from("content_jobs")
      .select("id")
      .eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new PortfolioClaimLost();
  };

  try {
    const savedProgress = result.portfolioDraftProgress
      && typeof result.portfolioDraftProgress === "object"
      ? result.portfolioDraftProgress as PortfolioDraftProgress
      : mockup.legacyDraftProgress;
    await checkpoint({
      designCompleted: true,
      draftStartedAt: claimStartedAt,
    });
    const { draft, validation } = await createPortfolioDraft({
      review: mockup.review,
      assets: mockup.assets,
      progress: savedProgress,
      shouldYield,
      onProgress: async (progress) => {
        await checkpoint({ portfolioDraftProgress: progress });
      },
    });
    const completedAt = new Date().toISOString();
    const hasBlockingIssue = hasBlockingPortfolioDraftIssue(validation.issues);
    await assertClaim();

    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("metadata,updated_at")
      .eq("id", job.candidate_id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    const { data: workItem, error: workItemError } = await admin.from("content_work_items")
      .select("metadata,status,updated_at")
      .eq("id", job.work_item_id)
      .single();
    if (workItemError) throw new Error(workItemError.message);
    if (!ownsPortfolioGeneration(
      workItem.metadata,
      mockup.portfolioGenerationId,
      mockup.sourceFingerprint,
      mockup.portfolioRuleVersion,
    )) {
      throw new PortfolioClaimLost();
    }

    // Complete the exact claimed draft before exposing Gemini output. If a
    // rebuild invalidated the row, this CAS loses and no draft metadata moves.
    result = {
      ...result,
      sourceFingerprint: mockup.sourceFingerprint,
      portfolioRuleVersion: mockup.portfolioRuleVersion,
      portfolioGenerationId: mockup.portfolioGenerationId,
      redactionProof: mockup.redactionProof,
      generated: draft,
      validation,
      completedAt,
    };
    const { data: completedJob, error: completedJobError } = await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      next_retry_at: null,
      last_error_code: null,
      result,
      updated_at: completedAt,
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (completedJobError) throw new Error(completedJobError.message);
    if (!completedJob) throw new PortfolioClaimLost();
    committedJobAt = completedAt;

    const { data: committedWorkItem, error: workUpdateError } = await admin
      .from("content_work_items")
      .update({
      title: draft.title,
      summary: draft.summary,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      review_note: hasBlockingIssue
        ? `자동 검증 보류: ${validation.issues.join(" · ")}`
        : `대표 이미지 1장과 서로 다른 본문 목업 ${mockup.assets.filter((asset) => asset.kind === "body_image").length}장을 배치한 비공개 초안입니다. 사실관계·가림 처리·문체를 검수해주세요.`,
      metadata: {
        ...(workItem.metadata || {}),
        generated: draft,
        portfolioReview: mockup.review,
        portfolioAssets: mockup.assets,
        portfolioSourceFingerprint: mockup.sourceFingerprint,
        portfolioRuleVersion: mockup.portfolioRuleVersion,
        portfolioGenerationId: mockup.portfolioGenerationId,
        redactionMode: mockup.redactionMode,
        confidentialRegions: mockup.confidentialRegions,
        redactionProof: mockup.redactionProof,
        portfolioMockup: mockup.portfolioMockup,
        portfolioStage: "draft_completed",
        validation,
        generatedAt: completedAt,
        draftCompletedAt: completedAt,
        draftRetryAt: null,
        draftLastErrorCode: null,
      },
      updated_at: completedAt,
    }).eq("id", job.work_item_id)
      .eq("status", workItem.status)
      .eq("updated_at", workItem.updated_at)
      .contains("metadata", {
        portfolioGenerationId: mockup.portfolioGenerationId,
        portfolioSourceFingerprint: mockup.sourceFingerprint,
        portfolioRuleVersion: mockup.portfolioRuleVersion,
      })
      .select("id")
      .maybeSingle();
    if (workUpdateError) throw new Error(workUpdateError.message);
    if (!committedWorkItem) throw new PortfolioClaimLost();

    const { data: committedCandidate, error: candidateUpdateError } = await admin
      .from("portfolio_candidates")
      .update({
        status: "processed",
        metadata: {
          ...(candidate.metadata || {}),
          draftCompletedAt: completedAt,
        },
        updated_at: completedAt,
      })
      .eq("id", job.candidate_id)
      .eq("updated_at", candidate.updated_at)
      .select("id")
      .maybeSingle();
    if (candidateUpdateError) throw new Error(candidateUpdateError.message);
    if (!committedCandidate) throw new PortfolioClaimLost();

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      stage: "draft_completed",
      title: draft.title,
      assetCount: mockup.assets.length,
      validation,
    };
  } catch (error) {
    if (error instanceof PortfolioClaimLost) {
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "creating",
        stage: "design_completed",
        claimLost: true,
      };
    }
    if (committedJobAt) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "포트폴리오 본문 결과 저장 실패";
      const { error: completionNoteError } = await admin.from("content_jobs").update({
        error_message: message,
        updated_at: failedAt,
      }).eq("id", job.id)
        .eq("status", "completed")
        .eq("completed_at", committedJobAt);
      if (completionNoteError) throw new Error(completionNoteError.message);
      await markOwnedGenerationOnHold(admin, {
        workItemId: job.work_item_id,
        generationId: mockup.portfolioGenerationId,
        sourceFingerprint: mockup.sourceFingerprint,
        ruleVersion: mockup.portfolioRuleVersion,
        message: `본문 결과 저장 보류: ${message}`,
        stage: "draft_side_effect_failed",
        failedAt,
      });
      throw error;
    }
    if (error instanceof PortfolioCheckpointYield) {
      const checkpointedAt = new Date().toISOString();
      const { data: yieldedJob, error: yieldError } = await admin.from("content_jobs").update({
        status: "queued",
        attempts,
        started_at: null,
        completed_at: null,
        error_message: null,
        next_retry_at: null,
        result,
        updated_at: checkpointedAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (yieldError) throw new Error(yieldError.message);
      if (!yieldedJob) return null;
      await updatePortfolioWorkItemIfOwned(admin, {
        workItemId: job.work_item_id,
        owns: (metadata) => ownsPortfolioGeneration(
          metadata,
          mockup.portfolioGenerationId,
          mockup.sourceFingerprint,
          mockup.portfolioRuleVersion,
        ),
        requiredMetadata: {
          portfolioGenerationId: mockup.portfolioGenerationId,
          portfolioSourceFingerprint: mockup.sourceFingerprint,
          portfolioRuleVersion: mockup.portfolioRuleVersion,
        },
        values: (metadata) => ({
          status: "creating",
          summary: "포트폴리오 디자인은 완료되었습니다. 저장된 단계부터 본문 작성을 이어서 진행합니다.",
          review_note: null,
          metadata: { ...metadata, portfolioStage: "design_completed" },
          updated_at: checkpointedAt,
        }),
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "creating",
        stage: "design_completed",
        checkpointed: true,
      };
    }
    if (error instanceof GeminiRequestError) {
      const retry = geminiRetryDecision(error, Number(result.retryCount || 0));
      result = { ...result, retryCount: retry.retryCount };
      const retryAt = new Date().toISOString();
      const { data: retriedJob, error: retryUpdateError } = await admin.from("content_jobs").update({
        status: retry.retryable ? "failed" : "on_hold",
        attempts: retry.retryable ? 0 : attempts,
        next_retry_at: retry.nextRetryAt,
        last_error_code: retry.code,
        error_message: error.message,
        completed_at: retryAt,
        result,
        updated_at: retryAt,
      }).eq("id", job.id)
        .eq("status", "running")
        .eq("started_at", claimStartedAt)
        .select("id")
        .maybeSingle();
      if (retryUpdateError) throw new Error(retryUpdateError.message);
      if (!retriedJob) return null;
      await updatePortfolioWorkItemIfOwned(admin, {
        workItemId: job.work_item_id,
        owns: (metadata) => ownsPortfolioGeneration(
          metadata,
          mockup.portfolioGenerationId,
          mockup.sourceFingerprint,
          mockup.portfolioRuleVersion,
        ),
        requiredMetadata: {
          portfolioGenerationId: mockup.portfolioGenerationId,
          portfolioSourceFingerprint: mockup.sourceFingerprint,
          portfolioRuleVersion: mockup.portfolioRuleVersion,
        },
        values: (metadata) => ({
          status: retry.retryable ? "creating" : "on_hold",
          summary: retry.retryable
            ? "포트폴리오 디자인은 완료되었습니다. Gemini 글쓰기만 자동 재시도합니다."
            : "포트폴리오 디자인은 완료되었지만 본문 생성은 관리자 확인이 필요합니다.",
          review_note: retry.retryable
            ? `Gemini 글쓰기 일시 오류로 자동 재시도 예정: ${retry.nextRetryAt}`
            : `본문 자동 생성 보류: ${error.message}`,
          metadata: {
            ...metadata,
            portfolioStage: retry.retryable ? "draft_retry_wait" : "draft_failed",
            draftRetryAt: retry.nextRetryAt,
            draftLastErrorCode: retry.code,
          },
          updated_at: retryAt,
        }),
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: retry.retryable ? "creating" : "on_hold",
        stage: retry.retryable ? "draft_retry_wait" : "draft_failed",
        retry,
        assetCount: mockup.assets.length,
      };
    }
    const message = error instanceof Error ? error.message : "포트폴리오 본문 생성 실패";
    const failedAt = new Date().toISOString();
    const { data: failedJob, error: failedJobError } = await admin.from("content_jobs").update({
      status: "failed",
      error_message: message,
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (failedJobError) throw new Error(failedJobError.message);
    if (!failedJob) return null;
    await updatePortfolioWorkItemIfOwned(admin, {
      workItemId: job.work_item_id,
      owns: (metadata) => ownsPortfolioGeneration(
        metadata,
        mockup.portfolioGenerationId,
        mockup.sourceFingerprint,
        mockup.portfolioRuleVersion,
      ),
      requiredMetadata: {
        portfolioGenerationId: mockup.portfolioGenerationId,
        portfolioSourceFingerprint: mockup.sourceFingerprint,
        portfolioRuleVersion: mockup.portfolioRuleVersion,
      },
      values: (metadata) => ({
        status: "on_hold",
        summary: "포트폴리오 디자인은 완료되었지만 본문 생성은 관리자 확인이 필요합니다.",
        review_note: `본문 자동 생성 보류: ${message}`,
        metadata: { ...metadata, portfolioStage: "draft_failed" },
        updated_at: failedAt,
      }),
    });
    throw error;
  }
}

export async function retryPortfolioDraft(workItemId: string) {
  const admin = contentAdmin();
  const { data: workItem, error } = await admin.from("content_work_items")
    .select("id,metadata")
    .eq("id", workItemId)
    .single();
  if (error) throw new Error(error.message);
  const metadata = (workItem.metadata || {}) as Record<string, unknown> & {
    candidateId?: string;
  };
  const candidateId = metadata.candidateId;
  if (!candidateId) return null;
  const now = new Date().toISOString();
  const { data: resetJob, error: resetError } = await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
    started_at: null,
    completed_at: null,
    next_retry_at: null,
    last_error_code: null,
    error_message: null,
    result: { manuallyRetriedAt: now },
    updated_at: now,
  }).eq("candidate_id", candidateId)
    .eq("job_type", "draft")
    .neq("status", "running")
    .select("id")
    .maybeSingle();
  if (resetError) throw new Error(resetError.message);
  if (!resetJob) return null;
  await admin.from("content_work_items").update({
    status: "creating",
    summary: "포트폴리오 디자인은 그대로 유지하고 Gemini 본문만 다시 생성합니다.",
    review_note: null,
    metadata: {
      ...metadata,
      portfolioStage: "design_completed",
      draftRetryAt: null,
      draftLastErrorCode: null,
    },
    updated_at: now,
  }).eq("id", workItemId);
  return processNextPortfolioDraft(candidateId);
}

export async function rebuildPortfolioMockupsOnly(
  workItemId: string,
  options: { redactionMode?: "standard" | "confidential" } = {},
) {
  // Keep the legacy export for callers, but route every rebuild through the
  // claimed mockup/draft queue. The old inline writer had no durable claim and
  // could race a live conversion or publication.
  void options;
  return rebuildPortfolioDraft(workItemId);
  /* Retired inline implementation kept temporarily for history while callers
     move to the claimed queue above.
  const admin = contentAdmin();
  const { data: workItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,title,format,status,metadata")
    .eq("id", workItemId)
    .single();
  if (workItemError) throw new Error(workItemError.message);
  if (workItem.format !== "portfolio") {
    throw new Error("포트폴리오 작업만 목업 이미지를 다시 만들 수 있습니다.");
  }
  if (workItem.status === "published") {
    throw new Error("이미 발행한 포트폴리오는 자동으로 이미지를 교체할 수 없습니다.");
  }

  const metadata = (workItem.metadata || {}) as Record<string, unknown> & {
    candidateId?: string;
    portfolioReview?: PortfolioVisualReview;
    portfolioAssets?: GeneratedPortfolioAsset[];
    generated?: Record<string, unknown> & { bodyHtml?: string };
    redactionMode?: "standard" | "confidential";
    confidentialRegions?: SensitiveRegion[];
  };
  const candidateId = metadata.candidateId;
  const review = metadata.portfolioReview;
  const previousAssets = metadata.portfolioAssets;
  if (!candidateId || !review?.suitable || !Array.isArray(previousAssets) || !metadata.generated?.bodyHtml) {
    throw new Error("기존 원본·검토 결과·본문을 찾지 못해 이미지만 다시 만들 수 없습니다.");
  }

  const { data: conversion, error: conversionError } = await admin
    .from("content_jobs")
    .select("status,result,updated_at")
    .eq("candidate_id", candidateId)
    .eq("job_type", "convert")
    .maybeSingle();
  if (conversionError) throw new Error(conversionError.message);
  const conversionResult = (conversion?.result || {}) as JobResult;
  if (conversion?.status !== "completed" || !conversionResult.bucket || !conversionResult.slidePaths?.length) {
    throw new Error("변환된 원본 장표가 없어 목업 이미지를 다시 만들 수 없습니다.");
  }

  void options;
  const redactionMode = "confidential" as const;
  const localManifest = parseLocalRedactionManifest(
    conversionResult.localRedactionManifest,
    conversionResult.slidePaths.length,
  );
  if (!localManifest) {
    throw new Error("LOCAL_REDACTION_MANIFEST_REQUIRED: 최신 사무실 PC 변환 결과가 없어 이미지를 안전하게 다시 만들 수 없습니다.");
  }
  const localReview = await createLocalPortfolioReview({
    bucket: String(conversionResult.bucket),
    slidePaths: conversionResult.slidePaths,
    sourceHint: review.projectTitle,
  });
  const mockupPlan = portfolioMockupIndexes(conversionResult.slidePaths.length, localReview);
  const confidentialRegions = localRedactionRegions(localManifest, mockupPlan.indexes);
  const redactionVerification = {
    verified: mockupPlan.indexes.every((index) => (
      confidentialRegions.some((region) => region.slideIndex === index)
    )),
    regionCount: confidentialRegions.length,
    coverage: mockupPlan.indexes.reduce((sum, index) => sum + Math.min(1,
      confidentialRegions
        .filter((region) => region.slideIndex === index)
        .reduce((area, region) => area + region.width * region.height, 0)), 0)
      / mockupPlan.indexes.length,
  };
  if (!redactionVerification.verified) throw new Error("로컬 기밀 좌표가 일부 선정 장표를 포함하지 않습니다.");
  const sourceFingerprint = createPortfolioSourceFingerprint({
    bucket: String(conversionResult.bucket),
    slidePaths: conversionResult.slidePaths,
    conversionUpdatedAt: conversion.updated_at,
  });

  let slideProof: PortfolioSlideRedactionProof[] = [];
  const assets = await createPortfolioMockups({
    candidateId,
    bucket: String(conversionResult.bucket),
    slidePaths: conversionResult.slidePaths,
    review: localReview,
    extraSensitiveRegions: confidentialRegions,
    onRedactionProof: (proof) => {
      slideProof = proof;
    },
  });
  const redactionProof = createLocalRedactionProof({
    manifest: localManifest,
    sourceFingerprint,
    selectedSlideIndexes: mockupPlan.indexes,
    slides: slideProof,
  });
  const mockupMetadata = portfolioMockupMetadata({
    review: localReview,
    assets,
    verification: redactionVerification,
  });
  const generated = {
    ...metadata.generated,
    bodyHtml: replacePortfolioAssetUrls(metadata.generated.bodyHtml, previousAssets, assets),
  };
  const now = new Date().toISOString();

  const { error: deleteError } = await admin
    .from("content_review_assets")
    .delete()
    .eq("work_item_id", workItemId);
  if (deleteError) throw new Error(deleteError.message);
  const { error: assetsError } = await admin.from("content_review_assets").insert(
    assets.map((asset, index) => ({
      work_item_id: workItemId,
      asset_type: asset.kind,
      public_url: asset.url,
      sort_order: index,
      approved: false,
      review_note: `${asset.caption} · 원본 슬라이드 ${asset.slideIndexes.map((value) => value + 1).join(", ")}`,
    })),
  );
  if (assetsError) throw new Error(assetsError.message);

  const { error: jobError } = await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    error_message: null,
    result: {
      sourceFingerprint,
      portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
      visualReview: localReview,
      assets,
      redactionMode,
      confidentialRegions,
      redactionProof,
      portfolioMockup: mockupMetadata,
      mockupOnlyRebuiltAt: now,
    },
    updated_at: now,
  }).eq("candidate_id", candidateId).eq("job_type", "mockup");
  if (jobError) throw new Error(jobError.message);

  const { error: draftQueueError } = await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
    started_at: null,
    completed_at: null,
    next_retry_at: null,
    last_error_code: null,
    error_message: null,
    result: {},
    updated_at: now,
  }).eq("candidate_id", candidateId)
    .eq("job_type", "draft")
    .in("status", ["queued", "running", "completed", "on_hold", "failed"]);
  if (draftQueueError) throw new Error(draftQueueError.message);

  const { error: updateError } = await admin.from("content_work_items").update({
    status: "creating",
    summary: "디자인 목업을 로컬 기밀 블러 규칙으로 다시 만들었습니다. Gemini 본문만 별도 대기열에서 다시 작성합니다.",
    metadata: {
      ...metadata,
      generated,
      portfolioReview: localReview,
      portfolioAssets: assets,
      portfolioSourceFingerprint: sourceFingerprint,
      portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
      redactionMode,
      confidentialRegions,
      redactionProof,
      portfolioMockup: mockupMetadata,
      portfolioStage: "design_completed",
      designCompletedAt: now,
      mockupOnlyRebuiltAt: now,
    },
    updated_at: now,
  }).eq("id", workItemId);
  if (updateError) throw new Error(updateError.message);

  return {
    workItemId,
    candidateId,
    status: "creating",
    assetCount: assets.length,
    slideAspectRatio: assets[0]?.slideAspectRatio,
    redactionMode,
    redactionRegionCount: confidentialRegions.length,
    redactionCoverage: redactionVerification.coverage,
    redactionStatus: "verified",
    mockupMode: mockupMetadata.mode,
    aspectClass: mockupMetadata.aspectClass,
  };
  */
}

export async function retryPortfolioConversion(workItemId: string) {
  const admin = contentAdmin();
  const { data: workItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,format,status,metadata,updated_at")
    .eq("id", workItemId)
    .maybeSingle();
  if (workItemError) throw new Error(workItemError.message);
  if (!workItem) throw new PortfolioConversionRetryConflict("포트폴리오 작업을 찾지 못했습니다.");
  if (workItem.format !== "portfolio") {
    throw new PortfolioConversionRetryConflict("포트폴리오 작업만 원본 변환을 다시 시도할 수 있습니다.");
  }
  if (workItem.status === "published") {
    throw new PortfolioConversionRetryConflict("이미 발행된 작업은 원본 변환을 다시 실행할 수 없습니다.");
  }

  const { data: conversions, error: conversionError } = await admin
    .from("content_jobs")
    .select("id,candidate_id,status,result,error_message,attempts,max_attempts,updated_at")
    .eq("work_item_id", workItemId)
    .eq("job_type", "convert")
    .order("created_at", { ascending: false })
    .limit(2);
  if (conversionError) throw new Error(conversionError.message);
  if ((conversions || []).length > 1) {
    throw new PortfolioConversionRetryConflict("PC 변환 작업이 중복 연결되어 있어 다시 시도하지 않았습니다.");
  }
  const conversion = conversions?.[0];
  if (!conversion?.candidate_id) {
    throw new PortfolioConversionRetryConflict("연결된 PC 변환 작업과 포트폴리오 후보를 찾지 못했습니다.");
  }

  const metadata = (workItem.metadata || {}) as Record<string, unknown> & { candidateId?: unknown };
  if (typeof metadata.candidateId === "string" && metadata.candidateId !== conversion.candidate_id) {
    throw new PortfolioConversionRetryConflict("작업 항목과 원본 후보 연결이 일치하지 않아 다시 시도하지 않았습니다.");
  }
  const conversionState = portfolioConversionRecoveryState({
    status: conversion.status,
    result: (conversion.result || {}) as JobResult,
    errorMessage: conversion.error_message,
  });
  const needsLocalManifestRefresh = conversionState === "ready" && !parseLocalRedactionManifest(
    (conversion.result as JobResult | null)?.localRedactionManifest,
    Array.isArray((conversion.result as JobResult | null)?.slidePaths)
      ? ((conversion.result as JobResult).slidePaths || []).length
      : 0,
  );
  if (needsLocalManifestRefresh && isPdfPortfolioSource(conversion.result)) {
    throw new PortfolioConversionRetryConflict(
      `${PDF_LOCAL_REDACTION_ERROR_CODE}: ${PDF_LOCAL_REDACTION_MESSAGE}`,
    );
  }
  if (conversionState === "active") {
    throw new PortfolioConversionRetryConflict("원본 변환이 이미 대기 중이거나 다른 PC에서 실행 중입니다.");
  }
  if (conversionState === "ready" && !needsLocalManifestRefresh) {
    throw new PortfolioConversionRetryConflict("원본 변환이 이미 완료되어 목업 다시 만들기를 이용해야 합니다.");
  }
  if (conversionState !== "retryable" && !needsLocalManifestRefresh) {
    throw new PortfolioConversionRetryConflict("자동 재시도 한도에 도달한 PC 변환 작업만 이 기능으로 다시 실행할 수 있습니다.");
  }

  const [candidateResult, sourceResult, downstreamResult] = await Promise.all([
    admin.from("portfolio_candidates")
      .select("id")
      .eq("id", conversion.candidate_id)
      .maybeSingle(),
    admin.from("content_jobs")
      .select("id,result")
      .eq("candidate_id", conversion.candidate_id)
      .eq("work_item_id", workItemId)
      .eq("job_type", "download")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(2),
    admin.from("content_jobs")
      .select("id,job_type")
      .eq("candidate_id", conversion.candidate_id)
      .eq("work_item_id", workItemId)
      .in("job_type", ["mockup", "draft"]),
  ]);
  const validationError = candidateResult.error || sourceResult.error || downstreamResult.error;
  if (validationError) throw new Error(validationError.message);
  if (!candidateResult.data) {
    throw new PortfolioConversionRetryConflict("연결된 포트폴리오 후보가 없어 다시 시도하지 않았습니다.");
  }
  if ((sourceResult.data || []).length > 1) {
    throw new PortfolioConversionRetryConflict("완료된 원본 다운로드 작업이 중복 연결되어 있어 다시 시도하지 않았습니다.");
  }
  const source = sourceResult.data?.[0];
  if (!source || !isCompletePortfolioSourceDownload(source.result)) {
    throw new PortfolioConversionRetryConflict("원본 다운로드 연결이 완전하지 않아 PC 변환을 다시 요청할 수 없습니다.");
  }
  if (needsLocalManifestRefresh && isPdfPortfolioSource(source.result)) {
    throw new PortfolioConversionRetryConflict(
      `${PDF_LOCAL_REDACTION_ERROR_CODE}: ${PDF_LOCAL_REDACTION_MESSAGE}`,
    );
  }
  const downstreamTypes = new Set((downstreamResult.data || []).map((job) => job.job_type));
  if (!downstreamTypes.has("mockup") || !downstreamTypes.has("draft")) {
    throw new PortfolioConversionRetryConflict("후속 목업·본문 작업 연결이 완전하지 않아 다시 시도하지 않았습니다.");
  }

  const now = new Date().toISOString();
  const preservedMetadata: Record<string, unknown> = { ...metadata };
  for (const key of [
    "portfolioSourceFingerprint",
    "portfolioRuleVersion",
    "portfolioGenerationId",
    "portfolioConversionGenerationId",
    "generated",
    "portfolioAssets",
    "portfolioMockup",
    "portfolioReview",
    "validation",
    "redactionMode",
    "confidentialRegions",
    "redactionProof",
    "portfolioStage",
    "designCompletedAt",
    "generatedAt",
    "mockupOnlyRebuiltAt",
    "draftRetryCompletedAt",
    "rebuildRequestedAt",
  ]) delete preservedMetadata[key];

  // This optimistic write is the retry mutex. Concurrent requests validated
  // against the same snapshot cannot both proceed to reset downstream state.
  const { data: claimedWorkItem, error: claimError } = await admin
    .from("content_work_items")
    .update({
      status: "researching",
      summary: "문서 변환 PC에 원본 변환을 다시 요청했습니다. 새 작업자가 선점할 때까지 대기합니다.",
      review_note: null,
      retry_count: 0,
      next_retry_at: null,
      last_error_code: null,
      last_error_context: {},
      metadata: {
        ...preservedMetadata,
        candidateId: conversion.candidate_id,
        conversionRetryRequestedAt: now,
        portfolioSourceInvalidatedAt: now,
      },
      updated_at: now,
    })
    .eq("id", workItemId)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at)
    .neq("status", "published")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimedWorkItem) {
    throw new PortfolioConversionRetryConflict("작업 상태가 바뀌어 변환을 다시 요청하지 않았습니다. 새로고침 후 확인해 주세요.");
  }

  const downstreamIds = (downstreamResult.data || []).map((job) => job.id);
  const { error: downstreamResetError } = await admin.from("content_jobs").update({
    status: "on_hold",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    result: { conversionRetryRequestedAt: now },
    updated_at: now,
  }).in("id", downstreamIds);
  if (downstreamResetError) throw new Error(downstreamResetError.message);

  const { error: assetsError } = await admin.from("content_review_assets")
    .delete()
    .eq("work_item_id", workItemId);
  if (assetsError) throw new Error(assetsError.message);

  const { error: candidateResetError } = await admin.from("portfolio_candidates").update({
    status: "selected",
    font_status: "unchecked",
    updated_at: now,
  }).eq("id", conversion.candidate_id);
  if (candidateResetError) throw new Error(candidateResetError.message);

  const { error: workerResetError } = await admin.from("content_workers").update({
    current_job_id: null,
    updated_at: now,
  }).eq("current_job_id", conversion.id);
  if (workerResetError) throw new Error(workerResetError.message);

  // Publish to the worker queue only after every dependent record is reset.
  const { data: requeued, error: requeueError } = await admin.from("content_jobs").update({
    status: "pc_waiting",
    attempts: 0,
    claimed_by_worker_id: null,
    claimed_at: null,
    lease_expires_at: null,
    next_retry_at: null,
    last_error_code: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    result: {},
    updated_at: now,
  })
    .eq("id", conversion.id)
    .eq("status", conversion.status)
    .eq("updated_at", conversion.updated_at)
    .eq("attempts", conversion.attempts)
    .select("id")
    .maybeSingle();
  if (requeueError) throw new Error(requeueError.message);
  if (!requeued) {
    throw new PortfolioConversionRetryConflict("변환 작업 상태가 바뀌어 대기열에 다시 넣지 않았습니다. 새로고침 후 확인해 주세요.");
  }

  return {
    workItemId,
    candidateId: conversion.candidate_id,
    conversionJobId: conversion.id,
    status: "pc_waiting" as const,
    conversionRetry: true as const,
    requestedAt: now,
  };
}

export async function rebuildPortfolioDraft(workItemId: string) {
  const admin = contentAdmin();
  const { data: workItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,format,status,metadata,updated_at")
    .eq("id", workItemId)
    .single();
  if (workItemError) throw new Error(workItemError.message);
  if (workItem.format !== "portfolio") {
    throw new Error("포트폴리오 작업만 목업과 본문을 다시 만들 수 있습니다.");
  }
  if (workItem.status === "published") {
    throw new Error("이미 발행된 작업은 자동으로 다시 만들 수 없습니다.");
  }

  const metadata = (workItem.metadata || {}) as Record<string, unknown> & {
    candidateId?: string;
  };
  let candidateId = metadata.candidateId;
  if (!candidateId) {
    const { data: linkedJob, error: linkedJobError } = await admin
      .from("content_jobs")
      .select("candidate_id")
      .eq("work_item_id", workItemId)
      .not("candidate_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (linkedJobError) throw new Error(linkedJobError.message);
    candidateId = linkedJob?.candidate_id || undefined;
  }
  if (!candidateId) {
    throw new Error("연결된 포트폴리오 원본을 찾지 못했습니다.");
  }

  const { data: conversion, error: conversionError } = await admin
    .from("content_jobs")
    .select("status,result,error_message")
    .eq("candidate_id", candidateId)
    .eq("job_type", "convert")
    .maybeSingle();
  if (conversionError) throw new Error(conversionError.message);
  const conversionResult = (conversion?.result || {}) as JobResult;
  const conversionState = portfolioConversionRecoveryState({
    status: conversion?.status,
    result: conversionResult,
    errorMessage: conversion?.error_message,
  });
  if (conversionState === "active") {
    return {
      workItemId,
      candidateId,
      status: conversion?.status,
      conversionActive: true,
    };
  }
  if (conversionState === "retryable") {
    return retryPortfolioConversion(workItemId);
  }
  if (conversionState !== "ready") {
    throw new Error("변환이 끝난 슬라이드 원본이 없어 목업을 다시 만들 수 없습니다.");
  }
  const convertedSlidePaths = Array.isArray(conversionResult.slidePaths)
    ? conversionResult.slidePaths
    : [];
  if (!parseLocalRedactionManifest(
    conversionResult.localRedactionManifest,
    convertedSlidePaths.length,
  )) {
    if (isPdfPortfolioSource(conversionResult)) {
      throw new PortfolioConversionRetryConflict(
        `${PDF_LOCAL_REDACTION_ERROR_CODE}: ${PDF_LOCAL_REDACTION_MESSAGE}`,
      );
    }
    return retryPortfolioConversion(workItemId);
  }

  if (workItem.status === "creating") {
    const { data: activeJobs, error: activeJobsError } = await admin
      .from("content_jobs")
      .select("id,job_type,status,attempts,next_retry_at,error_message")
      .eq("candidate_id", candidateId)
      .in("job_type", ["mockup", "draft"]);
    if (activeJobsError) throw new Error(activeJobsError.message);
    const activeMockup = activeJobs?.find((job) => job.job_type === "mockup");
    const activeDraft = activeJobs?.find((job) => job.job_type === "draft");
    if (activeMockup?.status === "running") {
      return { workItemId, candidateId, status: "creating", alreadyRunning: true };
    }
    if (activeMockup?.status === "queued" || activeMockup?.status === "failed") {
      if (activeMockup.next_retry_at && new Date(activeMockup.next_retry_at).getTime() > Date.now()) {
        return {
          workItemId,
          candidateId,
          status: "creating",
          retryAt: activeMockup.next_retry_at,
        };
      }
      const resumed = await processNextPortfolioMockup(candidateId);
      if (resumed) return resumed;
      throw new Error(activeMockup.error_message || "저장된 포트폴리오 제작 작업을 이어가지 못했습니다.");
    }
    if (activeMockup?.status === "completed" && activeDraft?.status !== "completed") {
      if (activeDraft?.status === "running") {
        return {
          workItemId,
          candidateId,
          status: "creating",
          stage: "design_completed",
          alreadyRunning: true,
        };
      }
      if (activeDraft?.next_retry_at && new Date(activeDraft.next_retry_at).getTime() > Date.now()) {
        return {
          workItemId,
          candidateId,
          status: "creating",
          stage: "draft_retry_wait",
          retryAt: activeDraft.next_retry_at,
        };
      }
      if (activeDraft?.status === "on_hold") {
        if (Number(activeDraft.attempts || 0) > 0 || activeDraft.error_message) {
          throw new Error(activeDraft.error_message || "본문 작업이 관리자 확인 대기 상태입니다.");
        }
        const queuedAt = new Date().toISOString();
        const { data: queuedDraft, error: queueDraftError } = await admin
          .from("content_jobs")
          .update({
            status: "queued",
            started_at: null,
            completed_at: null,
            next_retry_at: null,
            error_message: null,
            updated_at: queuedAt,
          })
          .eq("id", activeDraft.id)
          .eq("status", "on_hold")
          .eq("attempts", 0)
          .is("error_message", null)
          .select("id")
          .maybeSingle();
        if (queueDraftError) throw new Error(queueDraftError.message);
        if (!queuedDraft) throw new PortfolioRebuildConflict();
      }
      const resumed = await processNextPortfolioDraft(candidateId);
      if (resumed) return resumed;
      throw new Error(activeDraft?.error_message || "완료된 디자인에 연결된 본문 작업을 이어가지 못했습니다.");
    }
  }

  const now = new Date().toISOString();
  const preservedMetadata: Record<string, unknown> = { ...metadata };
  for (const key of [
    "portfolioSourceFingerprint",
    "portfolioRuleVersion",
    "portfolioGenerationId",
    "portfolioConversionGenerationId",
    "generated",
    "portfolioAssets",
    "portfolioMockup",
    "portfolioReview",
    "validation",
    "redactionMode",
    "confidentialRegions",
    "redactionProof",
    "portfolioStage",
    "designCompletedAt",
    "generatedAt",
  ]) delete preservedMetadata[key];
  const { data: claimedWorkItem, error: claimWorkError } = await admin
    .from("content_work_items")
    .update({
      status: "creating",
      summary: "문서 장수와 규격을 판별해 우수 도식 중심 목업과 기밀 블러를 다시 만들고 있습니다.",
      review_note: null,
      metadata: {
        ...preservedMetadata,
        candidateId,
        rebuildRequestedAt: now,
      },
      updated_at: now,
    })
    .eq("id", workItemId)
    .eq("status", workItem.status)
    .eq("updated_at", workItem.updated_at)
    .neq("status", "published")
    .select("id")
    .maybeSingle();
  if (claimWorkError) throw new Error(claimWorkError.message);
  if (!claimedWorkItem) throw new PortfolioRebuildConflict();

  const { error: mockupResetError } = await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    result: { rebuildRequestedAt: now },
    updated_at: now,
  }).eq("candidate_id", candidateId).eq("job_type", "mockup");
  if (mockupResetError) throw new Error(mockupResetError.message);

  const { error: draftResetError } = await admin.from("content_jobs").update({
    status: "on_hold",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    result: {},
    updated_at: now,
  }).eq("candidate_id", candidateId).eq("job_type", "draft");
  if (draftResetError) throw new Error(draftResetError.message);

  const { error: candidateResetError } = await admin.from("portfolio_candidates").update({
    status: "selected",
    updated_at: now,
  }).eq("id", candidateId);
  if (candidateResetError) throw new Error(candidateResetError.message);

  const result = await processNextPortfolioMockup(candidateId);
  if (!result) throw new Error("다시 만들기 작업을 시작하지 못했습니다.");
  return result;
}
