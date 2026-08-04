import { contentAdmin } from "@/lib/content-ops/data";
import {
  createPortfolioSourceFingerprint,
  PORTFOLIO_RULE_VERSION,
} from "@/lib/content-ops/portfolio-rules";
import { GeminiRequestError, geminiRetryDecision } from "@/lib/gemini/client";
import { createPortfolioDraft } from "./draft";
import type { PortfolioDraftProgress } from "./draft";
import { createPortfolioMockups, portfolioMockupIndexes } from "./mockup";
import type { GeneratedPortfolioAsset } from "./mockup";
import {
  detectConfidentialRegions,
  reviewPortfolioSlides,
  verifyConfidentialRegions,
} from "./visual-review";
import type {
  PortfolioVisualReview,
  SensitiveRegion,
  SensitiveSlideAudit,
} from "./visual-review";
import {
  PortfolioCheckpointYield,
  yieldPortfolioCheckpointIfNeeded,
} from "./checkpoint";

class PortfolioClaimLost extends Error {
  constructor() {
    super("포트폴리오 작업 실행권이 새 원본 처리로 이전되었습니다.");
    this.name = "PortfolioClaimLost";
  }
}

export class PortfolioRebuildConflict extends Error {
  constructor() {
    super("원고 상태가 바뀌어 다시 만들기를 시작하지 않았습니다. 새로고침 후 다시 확인해 주세요.");
    this.name = "PortfolioRebuildConflict";
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

function portfolioMockupMetadata(input: {
  review: PortfolioVisualReview;
  assets: GeneratedPortfolioAsset[];
  verification: ReturnType<typeof verifyConfidentialRegions>;
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

async function rejectCandidate(input: {
  jobId: string;
  claimStartedAt: string;
  candidateId: string;
  workItemId: string;
  review: Awaited<ReturnType<typeof reviewPortfolioSlides>>;
}) {
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const reasons = input.review.rejectionReasons.length
    ? input.review.rejectionReasons
    : ["실제 페이지의 구성과 완성도가 포트폴리오 기준을 충족하지 않았습니다."];
  const { data: rejectedJob, error: rejectedJobError } = await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    result: { visualReview: input.review, rejected: true },
    error_message: null,
    updated_at: now,
  }).eq("id", input.jobId)
    .eq("status", "running")
    .eq("started_at", input.claimStartedAt)
    .select("id")
    .maybeSingle();
  if (rejectedJobError) throw new Error(rejectedJobError.message);
  if (!rejectedJob) throw new PortfolioClaimLost();
  await admin.from("content_jobs").update({
    status: "on_hold",
    error_message: "시각 적합성 판정에서 제외됨",
    updated_at: now,
  }).eq("candidate_id", input.candidateId).eq("job_type", "draft");
  const { data: candidate } = await admin.from("portfolio_candidates")
    .select("metadata")
    .eq("id", input.candidateId)
    .single();
  await admin.from("portfolio_candidates").update({
    status: "excluded",
    exclusion_reasons: reasons,
    metadata: {
      ...(candidate?.metadata || {}),
      visualReview: input.review,
      rejectedAt: now,
    },
    updated_at: now,
  }).eq("id", input.candidateId);
  const { data: workItem } = await admin.from("content_work_items")
    .select("metadata")
    .eq("id", input.workItemId)
    .single();
  await admin.from("content_work_items").update({
    status: "on_hold",
    summary: "실제 페이지를 확인한 결과 포트폴리오로 사용하지 않기로 자동 제외했습니다.",
    review_note: `시각 판정 제외: ${reasons.join(" · ")}`,
    metadata: {
      ...(workItem?.metadata || {}),
      portfolioReview: input.review,
    },
    updated_at: now,
  }).eq("id", input.workItemId);
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

    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("metadata")
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
    const baseReview = result.visualReviewBase as PortfolioVisualReview | undefined;
    const assessmentProgress = Array.isArray(result.slideAssessmentsProgress)
      ? result.slideAssessmentsProgress as PortfolioVisualReview["slideAssessments"]
      : [];
    const review = cachedReviewComplete
      ? cachedReview as PortfolioVisualReview
      : await reviewPortfolioSlides({
        bucket,
        slidePaths,
        shouldYield,
        baseReview: baseReview && typeof baseReview.suitable === "boolean" ? baseReview : undefined,
        existingAssessments: assessmentProgress,
        onBaseReview: async (value) => {
          await checkpoint({ visualReviewBase: value });
        },
        onAssessmentProgress: async (value, assessments) => {
          await checkpoint({
            visualReviewBase: value,
            slideAssessmentsProgress: assessments,
          });
        },
      });
    await checkpoint({
      visualReview: review,
      visualReviewBase: review,
      slideAssessmentsProgress: review.slideAssessments,
      visualReviewCompletedAt: new Date().toISOString(),
    });
    if (!review.suitable || review.confidence < 0.72 || review.recommendedSlideIndexes.length < 5) {
      await rejectCandidate({
        jobId: job.id,
        claimStartedAt,
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        review,
      });
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "rejected",
        review,
      };
    }

    const mockupPlan = portfolioMockupIndexes(slidePaths.length, review);
    const savedRegions = Array.isArray(result.confidentialRegionsProgress)
      ? result.confidentialRegionsProgress as SensitiveRegion[]
      : Array.isArray(result.confidentialRegions)
        ? result.confidentialRegions as SensitiveRegion[]
        : [];
    const completedRegionIndexes = Array.isArray(result.confidentialRegionsCompletedIndexes)
      ? result.confidentialRegionsCompletedIndexes
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0)
      : [];
    const savedAudits = Array.isArray(result.confidentialAuditsProgress)
      ? result.confidentialAuditsProgress as SensitiveSlideAudit[]
      : Array.isArray(result.confidentialAudits)
        ? result.confidentialAudits as SensitiveSlideAudit[]
        : [];
    const completedRegionSet = new Set(completedRegionIndexes);
    const allRegionIndexesCompleted = mockupPlan.indexes.every((index) => completedRegionSet.has(index));
    let confidentialRegions = savedRegions;
    let confidentialAudits = savedAudits;
    let redactionVerification = verifyConfidentialRegions(
      confidentialRegions,
      mockupPlan.indexes,
      confidentialAudits,
    );
    if (!redactionVerification.verified || !allRegionIndexesCompleted) {
      const detection = await detectConfidentialRegions({
        bucket,
        slidePaths,
        indexes: mockupPlan.indexes,
        existingRegions: savedRegions,
        existingAudits: savedAudits,
        completedIndexes: completedRegionIndexes,
        shouldYield,
        onProgress: async (progress, completedIndexes) => {
          await checkpoint({
            confidentialRegionsProgress: progress.regions,
            confidentialAuditsProgress: progress.audits,
            confidentialRegionsCompletedIndexes: completedIndexes,
          });
        },
      });
      confidentialRegions = detection.regions;
      confidentialAudits = detection.audits;
      redactionVerification = verifyConfidentialRegions(
        confidentialRegions,
        mockupPlan.indexes,
        confidentialAudits,
      );
    }
    if (!redactionVerification.verified) {
      const redactionDetectionPass = Number(result.redactionDetectionPass || 0) + 1;
      if (redactionDetectionPass < 3) {
        const failedIndexes = redactionVerification.failedSlideIndexes.length
          ? redactionVerification.failedSlideIndexes
          : mockupPlan.indexes;
        const failed = new Set(failedIndexes);
        const retryRegions = confidentialRegions.filter((region) => !failed.has(region.slideIndex));
        const retryAudits = confidentialAudits.filter((audit) => !failed.has(audit.slideIndex));
        const completedIndexes = mockupPlan.indexes.filter((index) => !failed.has(index));
        await checkpoint({
          confidentialRegionsProgress: retryRegions,
          confidentialAuditsProgress: retryAudits,
          confidentialRegionsCompletedIndexes: completedIndexes,
          redactionDetectionPass,
          redactionVerification,
        });
        throw new PortfolioCheckpointYield("불충분한 기밀 판정 장표를 다음 실행에서 다시 검사합니다.");
      }
      const { data: blockedItem } = await admin.from("content_work_items")
        .select("metadata")
        .eq("id", job.work_item_id)
        .single();
      await admin.from("content_work_items").update({
        metadata: {
          ...(blockedItem?.metadata || {}),
          portfolioMockup: {
            mode: mockupPlan.mode === "short" ? "short_psd" : "six_grid",
            bodyBoardCount: mockupPlan.mode === "short" ? 4 : mockupPlan.groups.length,
            aspectClass: "unknown",
            selectedSlideIndexes: mockupPlan.selectedIndexes,
            selectionReasons: [],
            redactionRegionCount: redactionVerification.regionCount,
            redactionCoverage: redactionVerification.coverage,
            redactionStatus: "blocked",
          },
        },
        updated_at: new Date().toISOString(),
      }).eq("id", job.work_item_id);
      throw new Error(redactionVerification.reason || "기밀 블러 검증을 통과하지 못했습니다.");
    }
    await checkpoint({
      confidentialRegions,
      confidentialRegionsProgress: confidentialRegions,
      confidentialAudits,
      confidentialAuditsProgress: confidentialAudits,
      confidentialRegionsCompletedIndexes: mockupPlan.indexes,
      redactionVerification,
      confidentialRegionsCompletedAt: new Date().toISOString(),
    });

    const cachedAssets = Array.isArray(result.portfolioAssetsProgress)
      ? result.portfolioAssetsProgress.filter(isGeneratedPortfolioAsset)
      : [];
    let assets = cachedAssets.length >= 4 ? cachedAssets : [];
    if (!assets.length) {
      yieldPortfolioCheckpointIfNeeded(shouldYield);
      await assertClaim();
      assets = await createPortfolioMockups({
        candidateId: job.candidate_id,
        bucket,
        slidePaths,
        review,
        extraSensitiveRegions: confidentialRegions,
      });
      await checkpoint({
        portfolioAssetsProgress: assets,
        portfolioAssetsCompletedAt: new Date().toISOString(),
      });
    }
    const mockupMetadata = portfolioMockupMetadata({
      review,
      assets,
      verification: redactionVerification,
    });
    const draftProgress = result.portfolioDraftProgress
      && typeof result.portfolioDraftProgress === "object"
      ? result.portfolioDraftProgress as PortfolioDraftProgress
      : undefined;
    yieldPortfolioCheckpointIfNeeded(shouldYield);
    const { draft, validation } = await createPortfolioDraft({
      review,
      assets,
      progress: draftProgress,
      shouldYield,
      onProgress: async (progress) => {
        await checkpoint({ portfolioDraftProgress: progress });
      },
    });
    const completedAt = new Date().toISOString();
    const hasBlockingIssue = validation.issues.some((issue) =>
      /짧음|김|H2|FAQ|미만|연속|설명 문단|내부 슬라이드/.test(issue));

    await assertClaim();
    await admin.from("content_review_assets").delete().eq("work_item_id", job.work_item_id);
    const { error: assetsError } = await admin.from("content_review_assets").insert(
      assets.map((asset, index) => ({
        work_item_id: job.work_item_id,
        asset_type: asset.kind,
        public_url: asset.url,
        sort_order: index,
        approved: false,
        review_note: `${asset.caption} · 원본 슬라이드 ${asset.slideIndexes.map((value) => value + 1).join(", ")}`,
      })),
    );
    if (assetsError) throw new Error(assetsError.message);

    await assertClaim();
    await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      result: { generated: draft, validation },
      updated_at: completedAt,
    }).eq("candidate_id", job.candidate_id).eq("job_type", "draft");
    await assertClaim();
    await admin.from("portfolio_candidates").update({
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
        portfolioMockup: mockupMetadata,
        draftCompletedAt: completedAt,
      },
      updated_at: completedAt,
    }).eq("id", job.candidate_id);

    const { data: workItem } = await admin.from("content_work_items")
      .select("metadata")
      .eq("id", job.work_item_id)
      .single();
    await assertClaim();
    await admin.from("content_work_items").update({
      title: draft.title,
      summary: draft.summary,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      source_label: "NAVER WORKS 실제 프로젝트 · AI 시각 판정",
      review_note: hasBlockingIssue
        ? `자동 검증 보류: ${validation.issues.join(" · ")}`
        : `대표 이미지 1장과 서로 다른 본문 목업 ${assets.filter((asset) => asset.kind === "body_image").length}장을 배치한 비공개 초안입니다. 사실관계·가림 처리·문체를 검수해주세요.`,
      metadata: {
        ...(workItem?.metadata || {}),
        generated: draft,
        portfolioReview: review,
        portfolioAssets: assets,
        portfolioSourceFingerprint: sourceFingerprint,
        portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
        redactionMode: "confidential",
        confidentialRegions,
        portfolioMockup: mockupMetadata,
        validation,
        generatedAt: completedAt,
      },
      updated_at: completedAt,
    }).eq("id", job.work_item_id);

    const { data: completedJob, error: completedJobError } = await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      next_retry_at: null,
      last_error_code: null,
      result: {
        sourceFingerprint,
        portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
        visualReview: review,
        assets,
        redactionMode: "confidential",
        confidentialRegions,
        portfolioMockup: mockupMetadata,
      },
      updated_at: completedAt,
    }).eq("id", job.id)
      .eq("status", "running")
      .eq("started_at", claimStartedAt)
      .select("id")
      .maybeSingle();
    if (completedJobError) throw new Error(completedJobError.message);
    if (!completedJob) throw new PortfolioClaimLost();

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      title: draft.title,
      assetCount: assets.length,
      validation,
    };
  } catch (error) {
    if (error instanceof PortfolioClaimLost) {
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "creating",
        claimLost: true,
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
      await admin.from("content_work_items").update({
        status: "creating",
        summary: "AI 실행 제한 시간 전에 진행 상황을 저장했습니다. 다음 자동 실행에서 이어서 제작합니다.",
        review_note: null,
        updated_at: checkpointedAt,
      }).eq("id", job.work_item_id);
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
      await admin.from("content_work_items").update({
        status: retry.retryable ? "creating" : "on_hold",
        review_note: retry.retryable
          ? `Gemini 일시 오류로 자동 재시도 예정: ${retry.nextRetryAt}`
          : `자동 제작 보류: ${error.message}`,
        updated_at: retryAt,
      }).eq("id", job.work_item_id);
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
    await admin.from("content_work_items").update({
      status: "on_hold",
      review_note: `자동 제작 보류: ${message}`,
      updated_at: failedAt,
    }).eq("id", job.work_item_id);
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
    portfolioReview?: PortfolioVisualReview;
    portfolioAssets?: GeneratedPortfolioAsset[];
  };
  const review = metadata.portfolioReview;
  const assets = metadata.portfolioAssets;
  const candidateId = metadata.candidateId;
  if (!review?.suitable || !Array.isArray(assets) || !assets.length || !candidateId) {
    return null;
  }
  const { draft, validation } = await createPortfolioDraft({
    review,
    assets,
  });
  const hasBlockingIssue = validation.issues.some((issue) =>
    /짧음|김|H2|FAQ|미만|연속|설명 문단|내부 슬라이드/.test(issue));
  const now = new Date().toISOString();
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    error_message: null,
    result: { generated: draft, validation, retriedAt: now },
    updated_at: now,
  }).eq("candidate_id", candidateId).eq("job_type", "draft");
  await admin.from("content_work_items").update({
    title: draft.title,
    summary: draft.summary,
    status: hasBlockingIssue ? "on_hold" : "review_required",
    review_note: hasBlockingIssue
      ? `자동 검증 보류: ${validation.issues.join(" · ")}`
      : `대표 이미지 1장과 서로 다른 본문 목업 ${assets.filter((asset) => asset.kind === "body_image").length}장을 배치한 비공개 초안입니다. 사실관계·가림 처리·문체를 검수해주세요.`,
    metadata: {
      ...metadata,
      generated: draft,
      validation,
      generatedAt: now,
      draftRetryCompletedAt: now,
    },
    updated_at: now,
  }).eq("id", workItemId);
  return {
    workItemId,
    candidateId,
    status: hasBlockingIssue ? "on_hold" : "review_required",
    title: draft.title,
    assetCount: assets.length,
    validation,
  };
}

function replacePortfolioAssetUrls(
  html: string,
  previousAssets: GeneratedPortfolioAsset[],
  nextAssets: GeneratedPortfolioAsset[],
) {
  const previousBodyAssets = previousAssets.filter((asset) => asset.kind === "body_image");
  const nextBodyAssets = nextAssets.filter((asset) => asset.kind === "body_image");
  return previousBodyAssets.reduce((result, previousAsset, index) => {
    const nextAsset = nextBodyAssets[index];
    if (!nextAsset) {
      const encodedUrl = previousAsset.url.replaceAll("&", "&amp;");
      return result.replace(/<figure\b[\s\S]*?<\/figure>/gi, (figure) => (
        figure.includes(previousAsset.url) || figure.includes(encodedUrl) ? "" : figure
      ));
    }
    return result
      .split(previousAsset.url)
      .join(nextAsset.url)
      .split(previousAsset.url.replaceAll("&", "&amp;"))
      .join(nextAsset.url.replaceAll("&", "&amp;"));
  }, html);
}

export async function rebuildPortfolioMockupsOnly(
  workItemId: string,
  options: { redactionMode?: "standard" | "confidential" } = {},
) {
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
    .select("status,result")
    .eq("candidate_id", candidateId)
    .eq("job_type", "convert")
    .maybeSingle();
  if (conversionError) throw new Error(conversionError.message);
  const conversionResult = (conversion?.result || {}) as JobResult;
  if (conversion?.status !== "completed" || !conversionResult.bucket || !conversionResult.slidePaths?.length) {
    throw new Error("변환된 원본 장표가 없어 목업 이미지를 다시 만들 수 없습니다.");
  }

  const redactionMode = "confidential" as const;
  const mockupPlan = portfolioMockupIndexes(conversionResult.slidePaths.length, review);
  review.selection = mockupPlan.selection;
  review.recommendedSlideIndexes = mockupPlan.selectedIndexes;
  const cachedVerification = verifyConfidentialRegions(
    metadata.confidentialRegions || [],
    mockupPlan.indexes,
  );
  const refreshConfidentialRegions = options.redactionMode === "confidential"
    || !cachedVerification.verified;
  const detection = refreshConfidentialRegions
    ? await detectConfidentialRegions({
      bucket: String(conversionResult.bucket),
      slidePaths: conversionResult.slidePaths,
      indexes: mockupPlan.indexes,
    })
    : { regions: metadata.confidentialRegions || [], audits: [] };
  const confidentialRegions = detection.regions;
  const redactionVerification = verifyConfidentialRegions(
    confidentialRegions,
    mockupPlan.indexes,
    detection.audits,
  );
  if (!redactionVerification.verified) {
    await admin.from("content_work_items").update({
      status: "on_hold",
      review_note: `자동 제작 보류: ${redactionVerification.reason || "기밀 블러 검증을 통과하지 못했습니다."}`,
      metadata: {
        ...metadata,
        portfolioMockup: {
          mode: mockupPlan.mode === "short" ? "short_psd" : "six_grid",
          bodyBoardCount: mockupPlan.mode === "short" ? 4 : mockupPlan.groups.length,
          aspectClass: "unknown",
          selectedSlideIndexes: mockupPlan.selectedIndexes,
          selectionReasons: [],
          redactionRegionCount: redactionVerification.regionCount,
          redactionCoverage: redactionVerification.coverage,
          redactionStatus: "blocked",
        },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", workItemId);
    throw new Error(redactionVerification.reason || "기밀 블러 검증을 통과하지 못했습니다.");
  }

  const assets = await createPortfolioMockups({
    candidateId,
    bucket: String(conversionResult.bucket),
    slidePaths: conversionResult.slidePaths,
    review,
    extraSensitiveRegions: confidentialRegions,
  });
  const mockupMetadata = portfolioMockupMetadata({
    review,
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
      visualReview: review,
      assets,
      redactionMode,
      confidentialRegions,
      portfolioMockup: mockupMetadata,
      mockupOnlyRebuiltAt: now,
    },
    updated_at: now,
  }).eq("candidate_id", candidateId).eq("job_type", "mockup");
  if (jobError) throw new Error(jobError.message);

  const { error: updateError } = await admin.from("content_work_items").update({
    metadata: {
      ...metadata,
      generated,
      portfolioAssets: assets,
      redactionMode,
      confidentialRegions,
      portfolioMockup: mockupMetadata,
      mockupOnlyRebuiltAt: now,
    },
    updated_at: now,
  }).eq("id", workItemId);
  if (updateError) throw new Error(updateError.message);

  return {
    workItemId,
    candidateId,
    status: workItem.status,
    assetCount: assets.length,
    slideAspectRatio: assets[0]?.slideAspectRatio,
    redactionMode,
    redactionRegionCount: confidentialRegions.length,
    redactionCoverage: redactionVerification.coverage,
    redactionStatus: "verified",
    mockupMode: mockupMetadata.mode,
    aspectClass: mockupMetadata.aspectClass,
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
    .select("status,result")
    .eq("candidate_id", candidateId)
    .eq("job_type", "convert")
    .maybeSingle();
  if (conversionError) throw new Error(conversionError.message);
  const conversionResult = (conversion?.result || {}) as JobResult;
  if (conversion?.status !== "completed" || !conversionResult.bucket || !conversionResult.slidePaths?.length) {
    throw new Error("변환이 끝난 슬라이드 원본이 없어 목업을 다시 만들 수 없습니다.");
  }

  if (workItem.status === "creating") {
    const { data: activeMockup, error: activeMockupError } = await admin
      .from("content_jobs")
      .select("status,next_retry_at,error_message")
      .eq("candidate_id", candidateId)
      .eq("job_type", "mockup")
      .maybeSingle();
    if (activeMockupError) throw new Error(activeMockupError.message);
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
  }

  const now = new Date().toISOString();
  const preservedMetadata: Record<string, unknown> = { ...metadata };
  for (const key of [
    "portfolioSourceFingerprint",
    "portfolioRuleVersion",
    "generated",
    "portfolioAssets",
    "portfolioMockup",
    "portfolioReview",
    "validation",
    "redactionMode",
    "confidentialRegions",
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
