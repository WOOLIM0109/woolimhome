import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerJobFailureDisposition } from "@/lib/pc-worker/job-state";
import { missingFontsFromMessage } from "@/lib/pc-worker/font-retry";
import { sendAdminPush } from "@/lib/notify/web-push";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;

  if (!body.jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const message = String(body.error || "PC document conversion failed.").slice(0, 1000);
  const missingFonts = missingFontsFromMessage(message);
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
  const waitingForFonts = missingFonts.length > 0;
  const willRetry = disposition === "retry";
  const recordedMessage = disposition === "exhausted"
    ? `${message}\nPC worker retry limit reached (${job.attempts}/${job.max_attempts}).`.slice(0, 1000)
    : message;
  const failureUpdate = waitingForFonts
    ? {
        status: "on_hold",
        claimed_by_worker_id: null,
        claimed_at: null,
        lease_expires_at: null,
        error_message: recordedMessage,
        last_error_code: "MISSING_FONTS",
        completed_at: null,
        updated_at: now,
      }
    : willRetry
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
      summary: waitingForFonts
        ? "원본 글꼴이 설치되면 회사 PC 변환을 자동으로 다시 시도합니다."
        : disposition === "retry"
        ? "문서 변환 PC에서 오류가 발생해 다른 워커가 다시 시도할 예정입니다."
        : disposition === "exhausted"
          ? "문서 변환 재시도 한도에 도달해 자동 처리를 중단했습니다. 관리자 확인 후 다시 실행해 주세요."
          : "발표자료 적합성 또는 원본 글꼴 검증을 통과하지 못해 자동 제작 대상에서 제외했습니다.",
      review_note: recordedMessage,
      updated_at: now,
    }).eq("id", job.work_item_id);
  }
  if (waitingForFonts && job.candidate_id) {
    await admin.from("portfolio_candidates").update({
      status: "on_hold",
      font_status: "missing",
      missing_fonts: missingFonts,
      font_retry_fingerprint: typeof body.fontInventoryFingerprint === "string"
        ? body.fontInventoryFingerprint.slice(0, 128)
        : null,
      selection_reasons: [message],
      updated_at: now,
    }).eq("id", job.candidate_id);
  } else if (disposition === "permanent" && job.candidate_id) {
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

  /*
   * 변환이 멈췄다는 사실을 사람에게 알립니다.
   *
   * 지금까지는 데이터베이스에 '보류'와 오류 코드만 적히고 끝이었습니다.
   * 관리자 화면을 직접 열어 보지 않으면 알 방법이 없었고, 그래서 멈춘 것을
   * 한참 뒤에야 알아채는 일이 반복됐습니다.
   *
   * 알림은 곁다리라 실패해도 워커 응답을 막지 않습니다.
   */
  const alert = waitingForFonts
    ? {
      title: "포트폴리오 변환 멈춤 · 글꼴 없음",
      body: `회사 PC에 없는 글꼴 ${missingFonts.length}개 때문에 변환이 멈췄습니다. ${missingFonts.slice(0, 3).join(", ")}${missingFonts.length > 3 ? " 외" : ""}`,
    }
    : disposition === "permanent" || disposition === "exhausted"
    ? {
      title: "포트폴리오 변환 실패",
      body: recordedMessage.slice(0, 160),
    }
    : null;
  if (alert) {
    try {
      await sendAdminPush({ ...alert, url: "/admin/content" });
    } catch {
      // 알림이 안 가도 변환 결과 기록은 이미 끝났습니다.
    }
  }

  return NextResponse.json({ ok: true, disposition: waitingForFonts ? "waiting_for_fonts" : disposition });
}
