import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import {
  type LocalRedactionManifest,
  validateLocalRedactionManifest,
} from "@/lib/pc-worker/redaction-manifest";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

function invalidatePortfolioMetadata(value: unknown, invalidatedAt: string) {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  for (const key of [
    "generated",
    "portfolioAssets",
    "portfolioMockup",
    "portfolioReview",
    "portfolioSourceFingerprint",
    "portfolioRuleVersion",
    "portfolioGenerationId",
    "portfolioConversionGenerationId",
    "validation",
    "redactionMode",
    "confidentialRegions",
    "redactionProof",
    "portfolioStage",
    "generatedAt",
    "mockupOnlyRebuiltAt",
    "draftRetryCompletedAt",
  ]) {
    delete metadata[key];
  }
  metadata.portfolioSourceInvalidatedAt = invalidatedAt;
  return metadata;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;

  if (
    !body.jobId
    || !body.bucket
    || !Array.isArray(body.slidePaths)
    || body.slidePaths.length < 5
    || body.slidePaths.some((path: unknown) => typeof path !== "string")
  ) {
    return NextResponse.json({ error: "Invalid completion request." }, { status: 400 });
  }

  const admin = contentAdmin();
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,status,result,updated_at")
    .eq("id", body.jobId)
    .eq("job_type", "convert")
    .in("status", ["pc_running", "completed"])
    .eq("claimed_by_worker_id", worker.id)
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) {
    return NextResponse.json(
      { error: "This job is no longer assigned to this worker." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const slidePaths = body.slidePaths.slice(0, 100) as string[];
  const { data: sourceJobs, error: sourceError } = await admin.from("content_jobs")
    .select("result")
    .eq("candidate_id", job.candidate_id)
    .eq("job_type", "download")
    .eq("status", "completed")
    .limit(1);
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });
  const sourceResult = sourceJobs?.[0]?.result as { originalFileName?: unknown } | undefined;
  const sourceFileName = typeof sourceResult?.originalFileName === "string"
    ? sourceResult.originalFileName
    : "";
  const sourceExtension = sourceFileName.split(".").pop()?.toLowerCase() || "";
  const isPowerPoint = ["ppt", "pptx", "pptm"].includes(sourceExtension);
  const isPdf = sourceExtension === "pdf";
  if (!isPowerPoint && !isPdf) {
    return NextResponse.json({ error: "The conversion source format could not be verified." }, { status: 409 });
  }
  let localRedactionManifest: LocalRedactionManifest | null = null;
  if (isPowerPoint) {
    if (typeof body.powerPointVersion !== "string" || !body.powerPointVersion.trim()) {
      return NextResponse.json({ error: "PowerPoint version is required for a PowerPoint completion." }, { status: 400 });
    }
    const validation = validateLocalRedactionManifest(body.localRedactionManifest, slidePaths.length);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    localRedactionManifest = validation.manifest;
  } else if (body.localRedactionManifest !== null && body.localRedactionManifest !== undefined) {
    return NextResponse.json({
      error: "PDF conversions cannot claim a local PowerPoint redaction manifest.",
    }, { status: 400 });
  }
  const previousResult = job.result && typeof job.result === "object"
    ? job.result as Record<string, unknown>
    : {};
  const previousSlidePaths = Array.isArray(previousResult.slidePaths)
    ? previousResult.slidePaths.map(String)
    : [];
  if (job.status === "completed") {
    const sameOutput = previousResult.bucket === body.bucket
      && JSON.stringify(previousSlidePaths) === JSON.stringify(slidePaths)
      && previousResult.pcWorkerId === worker.id
      && JSON.stringify(previousResult.localRedactionManifest ?? null)
        === JSON.stringify(localRedactionManifest);
    if (!sameOutput) {
      return NextResponse.json({
        error: "A completed conversion can only replay its exact original output.",
      }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      replayed: true,
      slideCount: slidePaths.length,
    });
  }
  const existingCompletionGenerationId = typeof previousResult.completionGenerationId === "string"
    ? previousResult.completionGenerationId
    : null;
  if (existingCompletionGenerationId && (
    previousResult.bucket !== body.bucket
    || JSON.stringify(previousSlidePaths) !== JSON.stringify(slidePaths)
    || previousResult.pcWorkerId !== worker.id
    || JSON.stringify(previousResult.localRedactionManifest ?? null)
      !== JSON.stringify(localRedactionManifest)
  )) {
    return NextResponse.json({
      error: "A staged conversion can only resume with its exact original output.",
    }, { status: 409 });
  }
  const completionGenerationId = existingCompletionGenerationId || `${job.id}:${now}`;
  const pcCompletedAt = typeof previousResult.pcCompletedAt === "string"
    ? previousResult.pcCompletedAt
    : now;
  const completedResult = {
    ...(job.result || {}),
    bucket: body.bucket,
    slidePaths,
    slideCount: slidePaths.length,
    pcWorkerId: worker.id,
    pcWorkerName: worker.displayName,
    pcCompletedAt,
    powerPointVersion: body.powerPointVersion || null,
    workerVersion: body.workerVersion || null,
    localRedactionManifest,
    completionGenerationId,
  };
  if (!existingCompletionGenerationId) {
    const { data: stagedJob, error: stagingError } = await admin.from("content_jobs").update({
      result: completedResult,
      updated_at: now,
    })
      .eq("id", job.id)
      .eq("status", "pc_running")
      .eq("claimed_by_worker_id", worker.id)
      .eq("updated_at", job.updated_at)
      .select("id")
      .maybeSingle();
    if (stagingError) return NextResponse.json({ error: stagingError.message }, { status: 500 });
    if (!stagedJob) {
      return NextResponse.json(
        { error: "This job was reassigned before completion staging." },
        { status: 409 },
      );
    }
  }

  const { data: currentWorkItem, error: workItemReadError } = await admin
    .from("content_work_items")
    .select("metadata,status,updated_at")
    .eq("id", job.work_item_id)
    .maybeSingle();
  if (workItemReadError) {
    return NextResponse.json({ error: workItemReadError.message }, { status: 500 });
  }
  if (!currentWorkItem) {
    return NextResponse.json({ error: "The portfolio work item could not be found." }, { status: 409 });
  }
  const currentMetadata = currentWorkItem.metadata && typeof currentWorkItem.metadata === "object"
    ? currentWorkItem.metadata as Record<string, unknown>
    : {};
  const alreadyOwnsCompletion = currentMetadata.portfolioConversionGenerationId
    === completionGenerationId;
  const protectedStatuses = new Set(["published", "scheduled", "naver_ready", "approved", "review_required"]);
  if (protectedStatuses.has(currentWorkItem.status)) {
    return NextResponse.json({
      error: "The completed conversion was preserved, but review or publication state changed. No downstream data was reset.",
    }, { status: 409 });
  }
  const invalidatedMetadata = alreadyOwnsCompletion ? currentMetadata : {
    ...invalidatePortfolioMetadata(currentMetadata, now),
    portfolioConversionGenerationId: completionGenerationId,
  };
  if (!alreadyOwnsCompletion) {
    const { data: invalidatedWorkItem, error: invalidationError } = await admin
      .from("content_work_items")
      .update({
        status: "creating",
        summary: `문서 변환 PC에서 원본 구성을 유지한 ${slidePaths.length}장의 페이지 이미지를 만들었습니다. 페이지 적합성 검토와 목업 제작을 이어서 진행합니다.`,
        review_note: null,
        metadata: invalidatedMetadata,
        updated_at: now,
      })
      .eq("id", job.work_item_id)
      .eq("status", currentWorkItem.status)
      .eq("updated_at", currentWorkItem.updated_at)
      .select("id")
      .maybeSingle();
    if (invalidationError) {
      return NextResponse.json({ error: invalidationError.message }, { status: 500 });
    }
    if (!invalidatedWorkItem) {
      return NextResponse.json({
        error: "The work item changed after conversion staging. No downstream data was reset.",
      }, { status: 409 });
    }
  }

  const assertCompletionOwnership = async () => {
    const { data, error } = await admin.from("content_work_items")
      .select("metadata,status")
      .eq("id", job.work_item_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const metadata = data?.metadata && typeof data.metadata === "object"
      ? data.metadata as Record<string, unknown>
      : {};
    return metadata.portfolioConversionGenerationId === completionGenerationId
      && !protectedStatuses.has(String(data?.status || ""));
  };

  const [candidateSnapshot, downstreamSnapshot, auxiliarySnapshot, assetSnapshot] = await Promise.all([
    admin.from("portfolio_candidates")
      .select("id,status,metadata,updated_at")
      .eq("id", job.candidate_id)
      .maybeSingle(),
    admin.from("content_jobs")
      .select("id,job_type,status,payload,updated_at")
      .eq("candidate_id", job.candidate_id)
      .in("job_type", ["mockup", "draft"]),
    admin.from("content_jobs")
      .select("id,status,result,updated_at")
      .eq("candidate_id", job.candidate_id)
      .in("job_type", ["font_check", "privacy_check"])
      .in("status", ["queued", "on_hold"]),
    admin.from("content_review_assets")
      .select("id")
      .eq("work_item_id", job.work_item_id),
  ]);
  const snapshotError = candidateSnapshot.error
    || downstreamSnapshot.error
    || auxiliarySnapshot.error
    || assetSnapshot.error;
  if (snapshotError) return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  if (!await assertCompletionOwnership()) {
    return NextResponse.json({
      error: "The work item changed after conversion completed. No downstream data was reset.",
    }, { status: 409 });
  }

  const downstream = downstreamSnapshot.data || [];
  const mockupJob = downstream.filter((item) => item.job_type === "mockup");
  const draftJob = downstream.filter((item) => item.job_type === "draft");
  if (mockupJob.length !== 1 || draftJob.length !== 1) {
    return NextResponse.json({
      error: "The portfolio mockup and draft jobs must each have one generation owner.",
    }, { status: 409 });
  }

  const completionWarnings: string[] = [];
  const candidate = candidateSnapshot.data;
  const candidateMetadata = candidate?.metadata && typeof candidate.metadata === "object"
    ? candidate.metadata as Record<string, unknown>
    : {};
  if (candidate && candidateMetadata.portfolioConversionGenerationId !== completionGenerationId) {
    const { data, error } = await admin.from("portfolio_candidates").update({
      status: "processed",
      font_status: "ready",
      metadata: {
        ...candidateMetadata,
        portfolioConversionGenerationId: completionGenerationId,
      },
      updated_at: now,
    }).eq("id", candidate.id)
      .eq("status", candidate.status)
      .eq("updated_at", candidate.updated_at)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) completionWarnings.push("The portfolio candidate changed and was not overwritten.");
  }

  for (const auxiliaryJob of auxiliarySnapshot.data || []) {
    const auxiliaryResult = auxiliaryJob.result && typeof auxiliaryJob.result === "object"
      ? auxiliaryJob.result as Record<string, unknown>
      : {};
    if (auxiliaryJob.status === "completed"
      && auxiliaryResult.completionGenerationId === completionGenerationId) continue;
    const { data, error } = await admin.from("content_jobs").update({
      status: "completed",
      completed_at: now,
      result: {
        completedBy: "pc_powerpoint_worker",
        completedAt: now,
        completionGenerationId,
      },
      updated_at: now,
    }).eq("id", auxiliaryJob.id)
      .eq("status", auxiliaryJob.status)
      .eq("updated_at", auxiliaryJob.updated_at)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) completionWarnings.push("An auxiliary job changed and was not overwritten.");
  }

  if (!await assertCompletionOwnership()) {
    return NextResponse.json({ error: "A newer portfolio generation owns this work item." }, { status: 409 });
  }
  const mockupSnapshot = mockupJob[0];
  const mockupPayload = mockupSnapshot.payload && typeof mockupSnapshot.payload === "object"
    ? mockupSnapshot.payload as Record<string, unknown>
    : {};
  const mockupAlreadyPrepared = mockupPayload.portfolioConversionGenerationId === completionGenerationId
    && mockupSnapshot.status === "queued";
  const resetMockup = mockupAlreadyPrepared
    ? { data: { id: mockupSnapshot.id }, error: null }
    : await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    payload: {
      waitsFor: "privacy_check",
      slidePaths,
      bucket: body.bucket,
      localRedactionManifest,
      portfolioConversionGenerationId: completionGenerationId,
    },
    result: {},
    started_at: null,
    completed_at: null,
    error_message: null,
    updated_at: now,
  }).eq("id", mockupSnapshot.id)
    .eq("status", mockupSnapshot.status)
    .eq("updated_at", mockupSnapshot.updated_at)
    .select("id")
    .maybeSingle();
  const resetMockupJob = resetMockup.data;
  const resetMockupError = resetMockup.error;
  if (resetMockupError) {
    return NextResponse.json({ error: resetMockupError.message }, { status: 500 });
  }
  if (!resetMockupJob) {
    return NextResponse.json({ error: "The portfolio mockup job could not be reset." }, { status: 409 });
  }
  if (!await assertCompletionOwnership()) {
    return NextResponse.json({ error: "A newer portfolio generation owns this work item." }, { status: 409 });
  }
  const draftSnapshot = draftJob[0];
  const draftPayload = draftSnapshot.payload && typeof draftSnapshot.payload === "object"
    ? draftSnapshot.payload as Record<string, unknown>
    : {};
  const draftAlreadyPrepared = draftPayload.portfolioConversionGenerationId === completionGenerationId
    && draftSnapshot.status === "on_hold";
  const resetDraft = draftAlreadyPrepared
    ? { data: { id: draftSnapshot.id }, error: null }
    : await admin.from("content_jobs").update({
    status: "on_hold",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    payload: {
      waitsFor: "mockup",
      portfolioConversionGenerationId: completionGenerationId,
    },
    result: {},
    started_at: null,
    completed_at: null,
    error_message: null,
    updated_at: now,
  }).eq("id", draftSnapshot.id)
    .eq("status", draftSnapshot.status)
    .eq("updated_at", draftSnapshot.updated_at)
    .select("id")
    .maybeSingle();
  const resetDraftJob = resetDraft.data;
  const resetDraftError = resetDraft.error;
  if (resetDraftError) {
    return NextResponse.json({ error: resetDraftError.message }, { status: 500 });
  }
  if (!resetDraftJob) {
    return NextResponse.json({ error: "The portfolio draft job changed and was not reset." }, { status: 409 });
  }

  const assetIds = (assetSnapshot.data || []).map((asset) => asset.id);
  if (assetIds.length) {
    if (!await assertCompletionOwnership()) {
      return NextResponse.json({ error: "A newer portfolio generation owns this work item." }, { status: 409 });
    }
    const { error: reviewAssetsError } = await admin
      .from("content_review_assets")
      .delete()
      .in("id", assetIds);
    if (reviewAssetsError) {
      return NextResponse.json({ error: reviewAssetsError.message }, { status: 500 });
    }
  }
  const { error: workerUpdateError } = await admin.from("content_workers").update({
    display_name: worker.displayName,
    status: "online",
    current_job_id: null,
    last_seen_at: now,
    last_error: null,
    updated_at: now,
  })
    .eq("id", worker.id)
    .eq("current_job_id", job.id);
  if (workerUpdateError) completionWarnings.push(workerUpdateError.message);

  if (!await assertCompletionOwnership()) {
    return NextResponse.json({
      error: "A newer portfolio generation owns this work item. Conversion completion was not finalized.",
    }, { status: 409 });
  }
  const finalizedAt = new Date().toISOString();
  const { data: completedJob, error: completionError } = await admin.from("content_jobs").update({
    status: "completed",
    completed_at: finalizedAt,
    lease_expires_at: null,
    error_message: null,
    result: completedResult,
    updated_at: finalizedAt,
  }).eq("id", job.id)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", worker.id)
    .contains("result", { completionGenerationId })
    .select("id")
    .maybeSingle();
  if (completionError) {
    return NextResponse.json({ error: completionError.message }, { status: 500 });
  }
  if (!completedJob) {
    return NextResponse.json({
      error: "The conversion completion owner changed before finalization.",
    }, { status: 409 });
  }

  try {
    const draft = await processNextPortfolioMockup(job.candidate_id);
    return NextResponse.json({
      ok: true,
      slideCount: slidePaths.length,
      draft,
      ...(completionWarnings.length ? { warnings: completionWarnings } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      slideCount: slidePaths.length,
      mockupQueued: true,
      mockupError: error instanceof Error ? error.message : "후속 목업 제작 대기",
      ...(completionWarnings.length ? { warnings: completionWarnings } : {}),
    });
  }
}
