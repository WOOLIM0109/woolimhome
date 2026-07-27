import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker, PC_WORKER_ID } from "@/lib/pc-worker/auth";

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  if (!body.jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const message = String(body.error || "PowerPoint conversion failed.").slice(0, 1000);
  const { data: job } = await admin.from("content_jobs")
    .select("work_item_id")
    .eq("id", body.jobId)
    .single();
  await admin.from("content_jobs").update({
    status: "pc_waiting",
    error_message: message,
    completed_at: null,
    updated_at: now,
  }).eq("id", body.jobId);
  if (job?.work_item_id) {
    await admin.from("content_work_items").update({
      status: "on_hold",
      summary: "회사 PC의 PowerPoint 변환에서 오류가 발생해 다시 시도할 예정입니다.",
      review_note: message,
      updated_at: now,
    }).eq("id", job.work_item_id);
  }
  await admin.from("content_workers").update({
    status: "error",
    current_job_id: null,
    last_seen_at: now,
    last_error: message,
    updated_at: now,
  }).eq("id", PC_WORKER_ID);
  return NextResponse.json({ ok: true });
}
