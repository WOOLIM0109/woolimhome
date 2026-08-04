import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerJobFailureDisposition } from "@/lib/pc-worker/job-state";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;

  if (!body.jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const message = String(body.error || "PC document conversion failed.").slice(0, 1000);
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .select("id,work_item_id,candidate_id,attempts,max_attempts")
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

  const disposition = workerJobFailureDisposition({
    retryable: body.retryable !== false,
    attempts: Number(job.attempts || 0),
    maxAttempts: Number(job.max_attempts || 0),
  });
  const willRetry = disposition === "retry";
  const recordedMessage = disposition === "exhausted"
    ? `${message}\nPC worker retry limit reached (${job.attempts}/${job.max_attempts}).`.slice(0, 1000)
    : message;
  const failureUpdate = willRetry
    ? {
        status: "pc_waiting",
        claimed_by_worker_id: null,
        claimed_at: null,
        lease_expires_at: null,
        error_message: recordedMessage,
        completed_at: null,
        updated_at: now,
      }
    : {
        status: "failed",
        claimed_by_worker_id: worker.id,
        lease_expires_at: null,
        error_message: recordedMessage,
        completed_at: null,
        updated_at: now,
      };
  const { data: failedJob, error: failureError } = await admin.from("content_jobs")
    .update(failureUpdate)
    .eq("id", body.jobId)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", worker.id)
    .select("id")
    .maybeSingle();
  if (failureError) return NextResponse.json({ error: failureError.message }, { status: 500 });
  if (!failedJob) {
    return NextResponse.json(
      { error: "This job was reassigned before the failure was recorded." },
      { status: 409 },
    );
  }

  if (job.work_item_id) {
    await admin.from("content_work_items").update({
      status: "on_hold",
      summary: disposition === "retry"
        ? "문서 변환 PC에서 오류가 발생해 다른 워커가 다시 시도할 예정입니다."
        : disposition === "exhausted"
          ? "문서 변환 재시도 한도에 도달해 자동 처리를 중단했습니다. 관리자 확인 후 다시 실행해 주세요."
          : "발표자료 적합성 또는 원본 글꼴 검증을 통과하지 못해 자동 제작 대상에서 제외했습니다.",
      review_note: recordedMessage,
      updated_at: now,
    }).eq("id", job.work_item_id);
  }
  if (disposition === "permanent" && job.candidate_id) {
    await admin.from("portfolio_candidates").update({
      status: "excluded",
      font_status: message.startsWith("MISSING_FONTS:") ? "missing" : "unchecked",
      selection_reasons: [message],
      updated_at: now,
    }).eq("id", job.candidate_id);
  } else if (disposition === "exhausted" && job.candidate_id) {
    await admin.from("portfolio_candidates").update({
      status: "on_hold",
      updated_at: now,
    }).eq("id", job.candidate_id)
      .in("status", ["candidate", "selected", "on_hold"]);
  }
  await admin.from("content_workers").update({
    display_name: worker.displayName,
    status: "error",
    current_job_id: null,
    last_seen_at: now,
    last_error: recordedMessage,
    updated_at: now,
  })
    .eq("id", worker.id)
    .eq("current_job_id", job.id);
  return NextResponse.json({ ok: true, disposition });
}
