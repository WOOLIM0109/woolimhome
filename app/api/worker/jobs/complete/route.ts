import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker, PC_WORKER_ID } from "@/lib/pc-worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  if (!body.jobId || !body.bucket || !Array.isArray(body.slidePaths) || !body.pdfPath) {
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
      storagePath: body.pdfPath,
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
    summary: `PowerPoint 원본 글꼴을 유지해 ${slidePaths.length}장의 슬라이드를 정확히 변환했습니다. 실제 페이지 적합성 판정과 목업 제작을 이어서 진행합니다.`,
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
  return NextResponse.json({ ok: true, slideCount: slidePaths.length });
}
