import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerLeaseSeconds } from "@/lib/pc-worker/identity";
import { workerJobFailureDisposition } from "@/lib/pc-worker/job-state";
import { sharedDriveDownloadAuthorization } from "@/lib/naver-works/client";

export const runtime = "nodejs";

type AdminClient = ReturnType<typeof contentAdmin>;

type ClaimedConversionJob = {
  id: string;
  candidate_id: string;
  work_item_id: string | null;
  result: Record<string, unknown> | null;
  lease_expires_at: string | null;
};

async function releaseClaim(
  admin: AdminClient,
  jobId: string,
  workerId: string,
  message: string,
) {
  const now = new Date().toISOString();
  const { data: job } = await admin.from("content_jobs")
    .select("id,work_item_id,candidate_id,attempts,max_attempts")
    .eq("id", jobId)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", workerId)
    .maybeSingle();
  if (!job) return;

  const disposition = workerJobFailureDisposition({
    retryable: true,
    attempts: Number(job.attempts || 0),
    maxAttempts: Number(job.max_attempts || 0),
  });
  const exhausted = disposition === "exhausted";
  const recordedMessage = exhausted
    ? `${message}\nPC worker retry limit reached (${job.attempts}/${job.max_attempts}).`.slice(0, 1000)
    : message.slice(0, 1000);
  const releaseUpdate = exhausted
    ? {
        status: "failed",
        claimed_by_worker_id: workerId,
        lease_expires_at: null,
        error_message: recordedMessage,
        updated_at: now,
      }
    : {
        status: "pc_waiting",
        claimed_by_worker_id: null,
        claimed_at: null,
        lease_expires_at: null,
        error_message: recordedMessage,
        updated_at: now,
      };
  await admin.from("content_jobs").update(releaseUpdate)
    .eq("id", jobId)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", workerId);
  if (exhausted && job.work_item_id) {
    await admin.from("content_work_items").update({
      status: "on_hold",
      summary: "문서 변환 재시도 한도에 도달해 자동 처리를 중단했습니다. 관리자 확인 후 다시 실행해 주세요.",
      review_note: recordedMessage,
      updated_at: now,
    }).eq("id", job.work_item_id);
  }
  if (exhausted && job.candidate_id) {
    await admin.from("portfolio_candidates").update({
      status: "on_hold",
      updated_at: now,
    }).eq("id", job.candidate_id)
      .in("status", ["candidate", "selected", "on_hold"]);
  }
  await admin.from("content_workers").update({
    status: "error",
    current_job_id: null,
    last_error: recordedMessage,
    updated_at: now,
  })
    .eq("id", workerId)
    .eq("current_job_id", jobId);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;
  const admin = contentAdmin();
  const now = new Date().toISOString();

  const { error: workerError } = await admin.from("content_workers").upsert({
    id: worker.id,
    display_name: worker.displayName,
    status: "online",
    last_seen_at: now,
    last_error: null,
    updated_at: now,
  }, { onConflict: "id" });
  if (workerError) return NextResponse.json({ error: workerError.message }, { status: 500 });

  const leaseSeconds = workerLeaseSeconds(worker);
  const claimResult = await admin
    .rpc("claim_next_pc_conversion_job", {
      p_worker_id: worker.id,
      p_lease_seconds: leaseSeconds,
    })
    .maybeSingle();
  const job = claimResult.data as ClaimedConversionJob | null;
  const claimError = claimResult.error;
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!job) {
    await admin.from("content_workers").update({
      status: "online",
      current_job_id: null,
      updated_at: now,
    }).eq("id", worker.id);
    return NextResponse.json({ job: null });
  }

  const { data: downloads, error: downloadError } = await admin.from("content_jobs")
    .select("result")
    .eq("candidate_id", job.candidate_id)
    .eq("job_type", "download")
    .eq("status", "completed")
    .limit(1);
  if (downloadError) {
    await releaseClaim(admin, job.id, worker.id, downloadError.message);
    return NextResponse.json({ error: downloadError.message }, { status: 500 });
  }

  const source = downloads?.[0]?.result as {
    bucket?: string;
    storagePath?: string;
    originalFileName?: string;
    delivery?: string;
    driveFileId?: string;
  } | undefined;
  if (!source?.originalFileName) {
    const message = "Source file is missing.";
    await releaseClaim(admin, job.id, worker.id, message);
    return NextResponse.json({ error: message }, { status: 409 });
  }

  let sourceUrl: string;
  let sourceAuthorization: string | null = null;
  try {
    if (source.delivery === "pc_direct") {
      const { data: driveFile, error: driveFileError } = await admin
        .from("naver_works_drive_files")
        .select("root_id,external_file_id")
        .eq("id", source.driveFileId)
        .single();
      if (driveFileError) throw driveFileError;

      const { data: root, error: rootError } = await admin
        .from("naver_works_drive_roots")
        .select("drive_type,external_drive_id")
        .eq("id", driveFile.root_id)
        .single();
      if (rootError) throw rootError;
      if (root.drive_type !== "shared_drive" || !root.external_drive_id) {
        throw new Error("Unsupported NAVER WORKS source.");
      }
      const download = await sharedDriveDownloadAuthorization(
        root.external_drive_id,
        driveFile.external_file_id,
      );
      sourceUrl = download.url;
      sourceAuthorization = download.authorization;
    } else {
      if (!source.bucket || !source.storagePath) {
        throw new Error("Stored source file is missing.");
      }
      const { data: signed, error: signedError } = await admin.storage
        .from(source.bucket)
        .createSignedUrl(source.storagePath, 1800);
      if (signedError || !signed?.signedUrl) {
        throw new Error(signedError?.message || "Signed source URL failed.");
      }
      sourceUrl = signed.signedUrl;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source authorization failed.";
    await releaseClaim(admin, job.id, worker.id, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: confirmedJob, error: confirmError } = await admin.from("content_jobs").update({
    result: {
      ...(job.result || {}),
      pcWorkerId: worker.id,
      pcWorkerName: worker.displayName,
      originalFileName: source.originalFileName,
    },
    updated_at: now,
  })
    .eq("id", job.id)
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", worker.id)
    .select("id,lease_expires_at")
    .maybeSingle();
  if (confirmError) {
    await releaseClaim(admin, job.id, worker.id, confirmError.message);
    return NextResponse.json({ error: confirmError.message }, { status: 500 });
  }
  if (!confirmedJob) {
    return NextResponse.json(
      { error: "This job is no longer assigned to this worker." },
      { status: 409 },
    );
  }

  await admin.from("content_workers").update({
    display_name: worker.displayName,
    status: "busy",
    current_job_id: job.id,
    last_seen_at: now,
    last_error: null,
    updated_at: now,
  }).eq("id", worker.id);
  await admin.from("content_work_items").update({
    status: "creating",
    summary: "문서 변환 PC가 원본을 내려받아 글꼴과 페이지 구성을 확인하고 이미지를 만들고 있습니다.",
    updated_at: now,
  }).eq("id", job.work_item_id);

  return NextResponse.json({
    job: {
      id: job.id,
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      workerId: worker.id,
      leaseExpiresAt: confirmedJob.lease_expires_at,
      fileName: source.originalFileName,
      sourceUrl,
      sourceAuthorization,
      sourceDelivery: source.delivery || "supabase",
    },
  });
}
