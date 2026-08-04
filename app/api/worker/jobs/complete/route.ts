import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    .select("id,candidate_id,work_item_id,result")
    .eq("id", body.jobId)
    .eq("job_type", "convert")
    .eq("status", "pc_running")
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
  const { data: completedJob, error: completionError } = await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    lease_expires_at: null,
    error_message: null,
    result: {
      ...(job.result || {}),
      bucket: body.bucket,
      slidePaths,
      slideCount: slidePaths.length,
      pcWorkerId: worker.id,
      pcWorkerName: worker.displayName,
      pcCompletedAt: now,
      powerPointVersion: body.powerPointVersion || null,
    },
    updated_at: now,
  })
    .eq("id", job.id)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", worker.id)
    .select("id")
    .maybeSingle();
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
  await admin.from("content_jobs").update({
    status: "queued",
    payload: { waitsFor: "privacy_check", slidePaths, bucket: body.bucket },
    updated_at: now,
  }).eq("candidate_id", job.candidate_id)
    .eq("job_type", "mockup")
    .in("status", ["on_hold", "failed"]);

  await admin.from("content_review_assets").delete().eq("work_item_id", job.work_item_id);
  await admin.from("content_work_items").update({
    status: "creating",
    summary: `문서 변환 PC에서 원본 구성을 유지한 ${slidePaths.length}장의 페이지 이미지를 만들었습니다. 페이지 적합성 검토와 목업 제작을 이어서 진행합니다.`,
    review_note: null,
    updated_at: now,
  }).eq("id", job.work_item_id);
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
    return NextResponse.json({ ok: true, slideCount: slidePaths.length, draft });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      slideCount: slidePaths.length,
      mockupQueued: true,
      mockupError: error instanceof Error ? error.message : "후속 목업 제작 대기",
    });
  }
}
