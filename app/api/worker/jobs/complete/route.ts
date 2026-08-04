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
    .select("id,candidate_id,work_item_id,status,result")
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
  if (job.status === "completed" && (
    previousResult.bucket !== body.bucket
    || JSON.stringify(previousSlidePaths) !== JSON.stringify(slidePaths)
    || previousResult.pcWorkerId !== worker.id
    || (previousResult.localRedactionManifest !== undefined
      && JSON.stringify(previousResult.localRedactionManifest) !== JSON.stringify(localRedactionManifest))
  )) {
    return NextResponse.json({
      error: "A completed conversion can only resume with its original output.",
    }, { status: 409 });
  }
  const { data: currentWorkItem, error: workItemReadError } = await admin
    .from("content_work_items")
    .select("metadata")
    .eq("id", job.work_item_id)
    .maybeSingle();
  if (workItemReadError) {
    return NextResponse.json({ error: workItemReadError.message }, { status: 500 });
  }
  if (!currentWorkItem) {
    return NextResponse.json({ error: "The portfolio work item could not be found." }, { status: 409 });
  }
  const invalidatedMetadata = invalidatePortfolioMetadata(currentWorkItem.metadata, now);
  const { data: preInvalidatedWorkItem, error: preInvalidationError } = await admin
    .from("content_work_items")
    .update({
      status: "creating",
      review_note: null,
      metadata: invalidatedMetadata,
      updated_at: now,
    })
    .eq("id", job.work_item_id)
    .select("id")
    .maybeSingle();
  if (preInvalidationError) {
    return NextResponse.json({ error: preInvalidationError.message }, { status: 500 });
  }
  if (!preInvalidatedWorkItem) {
    return NextResponse.json({ error: "The portfolio work item could not be invalidated." }, { status: 409 });
  }
  const completedResult = {
    ...(job.result || {}),
    bucket: body.bucket,
    slidePaths,
    slideCount: slidePaths.length,
    pcWorkerId: worker.id,
    pcWorkerName: worker.displayName,
    pcCompletedAt: now,
    powerPointVersion: body.powerPointVersion || null,
    workerVersion: body.workerVersion || null,
    localRedactionManifest,
  };
  const needsCompletedManifestBackfill = job.status === "completed"
    && previousResult.localRedactionManifest === undefined;
  const completion = job.status === "completed" && !needsCompletedManifestBackfill
    ? { data: { id: job.id }, error: null }
    : await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    lease_expires_at: null,
    error_message: null,
    result: completedResult,
    updated_at: now,
    })
      .eq("id", job.id)
      .eq("status", job.status)
      .eq("claimed_by_worker_id", worker.id)
      .select("id")
      .maybeSingle();
  const completedJob = completion.data;
  const completionError = completion.error;
  if (completionError) {
    return NextResponse.json({ error: completionError.message }, { status: 500 });
  }
  if (!completedJob) {
    return NextResponse.json(
      { error: "This job was reassigned before completion." },
      { status: 409 },
    );
  }

  await admin.from("portfolio_candidates").update({
    status: "processed",
    font_status: "ready",
    updated_at: now,
  }).eq("id", job.candidate_id);
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    result: { completedBy: "pc_powerpoint_worker", completedAt: now },
    updated_at: now,
  }).eq("candidate_id", job.candidate_id)
    .in("job_type", ["font_check", "privacy_check"])
    .in("status", ["queued", "on_hold"]);
  const { data: resetMockupJob, error: resetMockupError } = await admin.from("content_jobs").update({
    status: "queued",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    payload: {
      waitsFor: "privacy_check",
      slidePaths,
      bucket: body.bucket,
      localRedactionManifest,
    },
    result: {},
    started_at: null,
    completed_at: null,
    error_message: null,
    updated_at: now,
  }).eq("candidate_id", job.candidate_id)
    .eq("job_type", "mockup")
    .in("status", ["queued", "running", "completed", "on_hold", "failed"])
    .select("id")
    .maybeSingle();
  if (resetMockupError) {
    if (job.status === "pc_running") {
      await admin.from("content_jobs").update({
        status: "pc_running",
        completed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("status", "completed").eq("claimed_by_worker_id", worker.id);
    }
    return NextResponse.json({ error: resetMockupError.message }, { status: 500 });
  }
  if (!resetMockupJob) {
    if (job.status === "pc_running") {
      await admin.from("content_jobs").update({
        status: "pc_running",
        completed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("status", "completed").eq("claimed_by_worker_id", worker.id);
    }
    return NextResponse.json({ error: "The portfolio mockup job could not be reset." }, { status: 409 });
  }
  const { error: resetDraftError } = await admin.from("content_jobs").update({
    status: "on_hold",
    attempts: 0,
    next_retry_at: null,
    last_error_code: null,
    payload: { waitsFor: "mockup" },
    result: {},
    started_at: null,
    completed_at: null,
    error_message: null,
    updated_at: now,
  }).eq("candidate_id", job.candidate_id)
    .eq("job_type", "draft")
    .in("status", ["queued", "running", "completed", "on_hold", "failed"]);
  if (resetDraftError) {
    return NextResponse.json({ error: resetDraftError.message }, { status: 500 });
  }

  const { error: reviewAssetsError } = await admin
    .from("content_review_assets")
    .delete()
    .eq("work_item_id", job.work_item_id);
  const completionWarnings: string[] = [];
  if (reviewAssetsError) completionWarnings.push(reviewAssetsError.message);
  const { data: invalidatedWorkItem, error: workItemError } = await admin.from("content_work_items").update({
    status: "creating",
    summary: `문서 변환 PC에서 원본 구성을 유지한 ${slidePaths.length}장의 페이지 이미지를 만들었습니다. 페이지 적합성 검토와 목업 제작을 이어서 진행합니다.`,
    review_note: null,
    metadata: invalidatedMetadata,
    updated_at: now,
  }).eq("id", job.work_item_id)
    .select("id")
    .maybeSingle();
  if (workItemError) completionWarnings.push(workItemError.message);
  if (!invalidatedWorkItem) completionWarnings.push("The portfolio work item summary could not be refreshed.");
  await admin.from("content_workers").update({
    display_name: worker.displayName,
    status: "online",
    current_job_id: null,
    last_seen_at: now,
    last_error: null,
    updated_at: now,
  })
    .eq("id", worker.id)
    .eq("current_job_id", job.id);

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
