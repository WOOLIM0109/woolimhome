import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker, PC_WORKER_ID } from "@/lib/pc-worker/auth";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  if (
    !body.jobId ||
    !body.bucket ||
    !Array.isArray(body.slidePaths) ||
    body.slidePaths.length < 5 ||
    body.slidePaths.some((path: unknown) => typeof path !== "string")
  ) {
    return NextResponse.json({ error: "Invalid completion request." }, { status: 400 });
  }
  const admin = contentAdmin();
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,result")
    .eq("id", body.jobId)
    .eq("status", "pc_running")
    .single();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 404 });
  const now = new Date().toISOString();
  const slidePaths = body.slidePaths.slice(0, 100) as string[];
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: now,
    error_message: null,
    result: {
      ...(job.result || {}),
      bucket: body.bucket,
      slidePaths,
      slideCount: slidePaths.length,
      pcWorkerId: PC_WORKER_ID,
      pcCompletedAt: now,
      powerPointVersion: body.powerPointVersion || null,
    },
    updated_at: now,
  }).eq("id", job.id);
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
    summary: `회사 PC에서 원본 구성을 유지해 ${slidePaths.length}장의 페이지 이미지를 만들었습니다. 실제 페이지 적합성 판정과 목업 제작을 이어서 진행합니다.`,
    review_note: null,
    updated_at: now,
  }).eq("id", job.work_item_id);
  await admin.from("content_workers").update({
    status: "online",
    current_job_id: null,
    last_seen_at: now,
    last_error: null,
    updated_at: now,
  }).eq("id", PC_WORKER_ID);
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
