import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker, PC_WORKER_ID } from "@/lib/pc-worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const admin = contentAdmin();
  const { data: jobs, error } = await admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,result,attempts")
    .eq("job_type", "convert")
    .eq("status", "pc_waiting")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const job = jobs?.[0];
  if (!job) return NextResponse.json({ job: null });

  const { data: downloads, error: downloadError } = await admin.from("content_jobs")
    .select("result")
    .eq("candidate_id", job.candidate_id)
    .eq("job_type", "download")
    .eq("status", "completed")
    .limit(1);
  if (downloadError) return NextResponse.json({ error: downloadError.message }, { status: 500 });
  const source = downloads?.[0]?.result as {
    bucket?: string;
    storagePath?: string;
    originalFileName?: string;
  } | undefined;
  if (!source?.bucket || !source.storagePath || !source.originalFileName) {
    return NextResponse.json({ error: "Source file is missing." }, { status: 409 });
  }
  const { data: signed, error: signedError } = await admin.storage
    .from(source.bucket)
    .createSignedUrl(source.storagePath, 1800);
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: signedError?.message || "Signed source URL failed." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("content_jobs").update({
    status: "pc_running",
    attempts: Number(job.attempts || 0) + 1,
    started_at: now,
    completed_at: null,
    error_message: null,
    result: {
      ...(job.result || {}),
      pcWorkerId: PC_WORKER_ID,
      pcClaimedAt: now,
      originalFileName: source.originalFileName,
    },
    updated_at: now,
  }).eq("id", job.id).eq("status", "pc_waiting").select("id").maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return NextResponse.json({ job: null });

  await admin.from("content_workers").update({
    status: "busy",
    current_job_id: job.id,
    last_seen_at: now,
    updated_at: now,
  }).eq("id", PC_WORKER_ID);
  await admin.from("content_work_items").update({
    status: "creating",
    summary: "회사 PC의 PowerPoint가 원본 글꼴을 유지해 PDF와 슬라이드 이미지를 만들고 있습니다.",
    updated_at: now,
  }).eq("id", job.work_item_id);

  return NextResponse.json({
    job: {
      id: job.id,
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      fileName: source.originalFileName,
      sourceUrl: signed.signedUrl,
    },
  });
}
