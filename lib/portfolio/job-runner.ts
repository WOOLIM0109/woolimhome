import { contentAdmin } from "@/lib/content-ops/data";
import { createPortfolioDraft } from "./draft";
import { createPortfolioMockups, portfolioMockupIndexes } from "./mockup";
import type { GeneratedPortfolioAsset } from "./mockup";
import { detectConfidentialRegions, reviewPortfolioSlides } from "./visual-review";
import type { PortfolioVisualReview, SensitiveRegion } from "./visual-review";

type JobResult = {
  bucket?: string;
  slidePaths?: string[];
  originalFileName?: string;
  [key: string]: unknown;
};

async function rejectCandidate(input: {
  jobId: string;
  candidateId: string;
  workItemId: string;
  review: Awaited<ReturnType<typeof reviewPortfolioSlides>>;
}) {
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const reasons = input.review.rejectionReasons.length
    ? input.review.rejectionReasons
    : ["실제 페이지의 구성과 완성도가 포트폴리오 기준을 충족하지 않았습니다."];
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    result: { visualReview: input.review, rejected: true },
    error_message: null,
    updated_at: now,
  }).eq("id", input.jobId);
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
  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,status,result,payload,attempts,max_attempts,error_message")
    .eq("job_type", "mockup")
    .in("status", ["queued", "failed"])
    .order("created_at", { ascending: true })
    .limit(1);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);
  const job = jobs?.[0];
  if (!job) return null;
  let attempts = Number(job.attempts || 0);
  const result = (job.result || {}) as Record<string, unknown>;
  const recoverableJsonFailure = /Unexpected non-whitespace|AI JSON|JSON 객체/i
    .test(String(job.error_message || ""));
  if (attempts >= Number(job.max_attempts || 3)) {
    if (!recoverableJsonFailure || result.jsonFormatRecoveryAttemptedAt) return null;
    const recoveryAt = new Date().toISOString();
    const { error: recoveryError } = await admin.from("content_jobs").update({
      attempts: 0,
      result: { ...result, jsonFormatRecoveryAttemptedAt: recoveryAt },
      error_message: null,
      updated_at: recoveryAt,
    }).eq("id", job.id);
    if (recoveryError) throw new Error(recoveryError.message);
    attempts = 0;
  }

  const now = new Date().toISOString();
  await admin.from("content_jobs").update({
    status: "running",
    attempts: attempts + 1,
    started_at: now,
    completed_at: null,
    error_message: null,
    updated_at: now,
  }).eq("id", job.id);

  try {
    const { data: conversion, error: conversionError } = await admin.from("content_jobs")
      .select("result")
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

    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("metadata,naver_works_drive_files(file_name,file_path)")
      .eq("id", job.candidate_id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    const driveFile = Array.isArray(candidate.naver_works_drive_files)
      ? candidate.naver_works_drive_files[0]
      : candidate.naver_works_drive_files;
    const sourceFileName = String(
      conversionResult.originalFileName || driveFile?.file_name || "디자인 프로젝트",
    );
    const review = await reviewPortfolioSlides({
      bucket,
      slidePaths,
      sourceFileName,
      sourcePath: driveFile?.file_path || "",
    });
    if (!review.suitable || review.confidence < 0.72 || review.recommendedSlideIndexes.length < 3) {
      await rejectCandidate({
        jobId: job.id,
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

    const assets = await createPortfolioMockups({
      candidateId: job.candidate_id,
      bucket,
      slidePaths,
      review,
    });
    const { draft, validation } = await createPortfolioDraft({
      sourceFileName,
      review,
      assets,
    });
    const completedAt = new Date().toISOString();
    const hasBlockingIssue = validation.issues.some((issue) =>
      /짧음|김|H2|FAQ|미만|연속|설명 문단|내부 슬라이드/.test(issue));

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

    await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      result: { visualReview: review, assets },
      updated_at: completedAt,
    }).eq("id", job.id);
    await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      result: { generated: draft, validation },
      updated_at: completedAt,
    }).eq("candidate_id", job.candidate_id).eq("job_type", "draft");
    await admin.from("portfolio_candidates").update({
      status: "processed",
      privacy_risk: review.sensitiveRegions.length ? "medium" : "low",
      quality_score: Math.round(review.confidence * 100),
      selection_reasons: review.reasons,
      metadata: {
        ...(candidate.metadata || {}),
        visualReview: review,
        mockupCount: assets.length,
        draftCompletedAt: completedAt,
      },
      updated_at: completedAt,
    }).eq("id", job.candidate_id);

    const { data: workItem } = await admin.from("content_work_items")
      .select("metadata")
      .eq("id", job.work_item_id)
      .single();
    await admin.from("content_work_items").update({
      title: draft.title,
      summary: draft.summary,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      source_label: "NAVER WORKS 실제 프로젝트 · AI 시각 판정",
      review_note: hasBlockingIssue
        ? `자동 검증 보류: ${validation.issues.join(" · ")}`
        : "대표 이미지 1장과 서로 다른 본문 목업 4장을 배치한 비공개 초안입니다. 사실관계·가림 처리·문체를 검수해주세요.",
      metadata: {
        ...(workItem?.metadata || {}),
        generated: draft,
        portfolioReview: review,
        portfolioAssets: assets,
        validation,
        generatedAt: completedAt,
      },
      updated_at: completedAt,
    }).eq("id", job.work_item_id);

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: hasBlockingIssue ? "on_hold" : "review_required",
      title: draft.title,
      assetCount: assets.length,
      validation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "포트폴리오 목업·초안 생성 실패";
    const failedAt = new Date().toISOString();
    await admin.from("content_jobs").update({
      status: "failed",
      error_message: message,
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq("id", job.id);
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
    sourceFileName?: string;
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
    sourceFileName: String(metadata.sourceFileName || "디자인 프로젝트"),
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
      : "대표 이미지 1장과 서로 다른 본문 목업 4장을 배치한 비공개 초안입니다. 사실관계·가림 처리·문체를 검수해주세요.",
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
    if (!nextAsset) return result;
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

  const redactionMode = options.redactionMode || metadata.redactionMode || "standard";
  const refreshConfidentialRegions = options.redactionMode === "confidential";
  const confidentialRegions = redactionMode === "confidential"
    ? !refreshConfidentialRegions && metadata.confidentialRegions
      ? metadata.confidentialRegions
      : await detectConfidentialRegions({
        bucket: String(conversionResult.bucket),
        slidePaths: conversionResult.slidePaths,
        indexes: portfolioMockupIndexes(conversionResult.slidePaths.length).indexes,
      })
    : [];
  if (redactionMode === "confidential" && !confidentialRegions.length) {
    throw new Error("기밀 본문과 사진 영역을 찾지 못해 이미지 교체를 중단했습니다.");
  }

  const assets = await createPortfolioMockups({
    candidateId,
    bucket: String(conversionResult.bucket),
    slidePaths: conversionResult.slidePaths,
    review,
    extraSensitiveRegions: confidentialRegions,
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
  };
}

export async function rebuildPortfolioDraft(workItemId: string) {
  const admin = contentAdmin();
  const { data: workItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,format,status,metadata")
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

  const now = new Date().toISOString();
  const { error: mockupResetError } = await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
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

  await admin.from("portfolio_candidates").update({
    status: "selected",
    updated_at: now,
  }).eq("id", candidateId);
  await admin.from("content_work_items").update({
    status: "creating",
    summary: "다량 문서 기준에 맞춰 4~6페이지 다중 목업 5장과 긴 본문을 다시 만들고 있습니다.",
    review_note: null,
    metadata: {
      ...metadata,
      candidateId,
      rebuildRequestedAt: now,
    },
    updated_at: now,
  }).eq("id", workItemId);

  const result = await processNextPortfolioMockup(candidateId);
  if (!result) throw new Error("다시 만들기 작업을 시작하지 못했습니다.");
  return result;
}
