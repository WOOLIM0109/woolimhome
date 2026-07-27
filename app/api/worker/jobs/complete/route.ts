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
  const reviewUrls = slidePaths.map((path) =>
    `/api/admin/assets?bucket=${encodeURIComponent(body.bucket)}&path=${encodeURIComponent(path)}`);

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
  if (reviewUrls.length) {
    await admin.from("content_review_assets").insert(reviewUrls.slice(0, 12).map((url, index) => ({
      work_item_id: job.work_item_id,
      asset_type: index === 0 ? "thumbnail" : "body_image",
      public_url: url,
      sort_order: index,
      approved: false,
      review_note: "PowerPoint 원본 렌더링 결과",
    })));
  }
  await admin.from("content_work_items").update({
    status: "review_required",
    summary: `PowerPoint 원본 글꼴을 유지해 ${slidePaths.length}장의 슬라이드 이미지를 만들었습니다. 개인정보와 사용할 장면을 검토해주세요.`,
    review_note: "PC PowerPoint 변환 완료. 목업 합성 전 원본 렌더링 검토 단계입니다.",
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
