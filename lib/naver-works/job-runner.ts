import { contentAdmin } from "@/lib/content-ops/data";
import { downloadSharedDriveFile } from "./client";
import {
  exceedsAutomatedSourceLimit,
  MAX_AUTOMATED_SOURCE_BYTES,
} from "./source-policy";

const MAX_DOWNLOAD_ATTEMPTS = 5;
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const PERMANENT_SIZE_ERROR =
  /exceeded the maximum allowed size|maximum allowed size|payload too large|http 413/i;

function contentType(fileName: string) {
  if (/\.pptx$/i.test(fileName)) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (/\.ppt$/i.test(fileName)) return "application/vnd.ms-powerpoint";
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  return "application/octet-stream";
}

function safeStorageName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0] || "";
  return `${crypto.randomUUID()}${extension.toLowerCase()}`;
}

function metadataValue(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function resumableUpload(
  bucket: string,
  storagePath: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase 저장소 환경변수가 설정되지 않았습니다.");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  const createResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      "tus-resumable": "1.0.0",
      "upload-length": String(bytes.byteLength),
      "upload-metadata": [
        `bucketName ${metadataValue(bucket)}`,
        `objectName ${metadataValue(storagePath)}`,
        `contentType ${metadataValue(mimeType)}`,
        `cacheControl ${metadataValue("3600")}`,
      ].join(","),
      "x-upsert": "false",
    },
  });
  if (createResponse.status !== 201) {
    throw new Error(`분할 업로드 생성 실패: ${createResponse.status} ${await createResponse.text()}`);
  }
  const uploadUrl = createResponse.headers.get("location");
  if (!uploadUrl) throw new Error("분할 업로드 URL이 비어 있습니다.");
  const resolvedUploadUrl = new URL(uploadUrl, endpoint).toString();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const chunk = bytes.slice(offset, Math.min(offset + TUS_CHUNK_BYTES, bytes.byteLength));
    const patchResponse = await fetch(resolvedUploadUrl, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        "tus-resumable": "1.0.0",
        "upload-offset": String(offset),
        "content-type": "application/offset+octet-stream",
      },
      body: chunk,
      signal: AbortSignal.timeout(30_000),
    });
    if (patchResponse.status !== 204) {
      throw new Error(`분할 업로드 실패: ${patchResponse.status} ${await patchResponse.text()}`);
    }
    offset = Number(patchResponse.headers.get("upload-offset") || offset + chunk.byteLength);
  }
}

async function excludeOversizedSource(options: {
  job: {
    id: string;
    candidate_id: string;
    work_item_id: string;
  };
  file: {
    id: string;
    file_name: string;
    file_size: number | null;
  };
  actualSize?: number;
  message?: string;
}) {
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const fileSize = Number(options.actualSize || options.file.file_size || 0);
  const message = options.message || "원본 파일이 자동 처리 상한인 75MB를 초과합니다.";
  const { data: candidate } = await admin.from("portfolio_candidates")
    .select("metadata,exclusion_reasons")
    .eq("id", options.job.candidate_id)
    .maybeSingle();
  const existingReasons = Array.isArray(candidate?.exclusion_reasons)
    ? candidate.exclusion_reasons.map(String)
    : [];
  const exclusionReasons = existingReasons.includes(message)
    ? existingReasons
    : [...existingReasons, message];

  const updates = await Promise.all([
    admin.from("content_jobs").update({
      status: "failed",
      attempts: MAX_DOWNLOAD_ATTEMPTS,
      error_message: message,
      completed_at: now,
      result: {
        excluded: true,
        exclusionCode: "source_too_large",
        fileName: options.file.file_name,
        fileSize,
        fileSizeLimit: MAX_AUTOMATED_SOURCE_BYTES,
      },
      updated_at: now,
    }).eq("id", options.job.id),
    admin.from("content_jobs").update({
      status: "on_hold",
      error_message: "용량 초과 원본이 제외되어 후속 작업을 실행하지 않습니다.",
      updated_at: now,
    }).eq("candidate_id", options.job.candidate_id)
      .neq("job_type", "download")
      .neq("status", "completed"),
    admin.from("portfolio_candidates").update({
      status: "excluded",
      exclusion_reasons: exclusionReasons,
      metadata: {
        ...((candidate?.metadata || {}) as Record<string, unknown>),
        excludedAt: now,
        exclusionCode: "source_too_large",
        sourceFileName: options.file.file_name,
        sourceFileSize: fileSize,
        sourceFileSizeLimit: MAX_AUTOMATED_SOURCE_BYTES,
      },
      updated_at: now,
    }).eq("id", options.job.candidate_id),
    admin.from("naver_works_drive_files").update({
      sync_status: "ignored",
      updated_at: now,
    }).eq("id", options.file.id),
    admin.from("content_work_items").update({
      status: "on_hold",
      summary: "자동 처리 용량을 초과한 원본을 제외했습니다. 다음 포트폴리오 후보로 자동 전환합니다.",
      review_note: `원본 다운로드 제외: ${message}`,
      updated_at: now,
    }).eq("id", options.job.work_item_id),
  ]);
  const failedUpdate = updates.find((result) => result.error);
  if (failedUpdate?.error) throw new Error(failedUpdate.error.message);

  return {
    candidateId: options.job.candidate_id,
    workItemId: options.job.work_item_id,
    status: "excluded" as const,
    reason: "source_too_large" as const,
    originalFileName: options.file.file_name,
    byteLength: fileSize,
  };
}

export async function excludeKnownOversizedPortfolioSource(candidateId: string) {
  const admin = contentAdmin();
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,error_message")
    .eq("candidate_id", candidateId)
    .eq("job_type", "download")
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return null;

  const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
    .select("drive_file_id")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) throw new Error(candidateError.message);
  if (!candidate?.drive_file_id) return null;

  const { data: file, error: fileError } = await admin.from("naver_works_drive_files")
    .select("id,file_name,file_size")
    .eq("id", candidate.drive_file_id)
    .maybeSingle();
  if (fileError) throw new Error(fileError.message);
  if (!file) return null;

  const knownSizeError = PERMANENT_SIZE_ERROR.test(String(job.error_message || ""));
  if (!knownSizeError && !exceedsAutomatedSourceLimit(file.file_size)) return null;
  return await excludeOversizedSource({
    job,
    file,
    message: knownSizeError
      ? "원본 파일이 저장소의 자동 처리 허용 용량을 초과합니다."
      : undefined,
  });
}

export async function processNextPortfolioDownload(candidateId?: string) {
  const admin = contentAdmin();
  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,payload,attempts")
    .eq("job_type", "download")
    .in("status", ["queued", "failed"])
    .lt("attempts", MAX_DOWNLOAD_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(1);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);
  const job = jobs?.[0];
  if (!job) return null;

  await admin.from("content_jobs").update({
    status: "running",
    attempts: Number(job.attempts || 0) + 1,
    started_at: new Date().toISOString(),
  }).eq("id", job.id);

  try {
    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates")
      .select("drive_file_id")
      .eq("id", job.candidate_id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    const { data: file, error: fileError } = await admin.from("naver_works_drive_files")
      .select("id,root_id,external_file_id,file_name,file_size")
      .eq("id", candidate.drive_file_id)
      .single();
    if (fileError) throw new Error(fileError.message);
    if (exceedsAutomatedSourceLimit(file.file_size)) {
      return await excludeOversizedSource({ job, file });
    }
    const { data: root, error: rootError } = await admin.from("naver_works_drive_roots")
      .select("drive_type,external_drive_id")
      .eq("id", file.root_id)
      .single();
    if (rootError) throw new Error(rootError.message);
    if (root.drive_type !== "shared_drive" || !root.external_drive_id) {
      throw new Error("현재 자동 다운로드는 NAVER WORKS 공용 폴더 원본만 지원합니다.");
    }

    const response = await downloadSharedDriveFile(root.external_drive_id, file.external_file_id);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (exceedsAutomatedSourceLimit(bytes.byteLength)) {
      return await excludeOversizedSource({ job, file, actualSize: bytes.byteLength });
    }

    const bucket = "portfolio-source";
    const { error: bucketError } = await admin.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: MAX_AUTOMATED_SOURCE_BYTES,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
    });
    if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) {
      throw new Error(bucketError.message);
    }
    const { error: bucketUpdateError } = await admin.storage.updateBucket(bucket, {
      public: false,
      fileSizeLimit: MAX_AUTOMATED_SOURCE_BYTES,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
    });
    if (bucketUpdateError) throw new Error(bucketUpdateError.message);
    const storagePath = `${job.candidate_id}/${safeStorageName(file.file_name)}`;
    const mimeType = contentType(file.file_name);
    if (bytes.byteLength > RESUMABLE_THRESHOLD_BYTES) {
      await resumableUpload(bucket, storagePath, bytes, mimeType);
    } else {
      const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
    }

    const completedAt = new Date().toISOString();
    const { error: completeError } = await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      result: {
        bucket,
        storagePath,
        originalFileName: file.file_name,
        byteLength: bytes.byteLength,
      },
    }).eq("id", job.id);
    if (completeError) throw new Error(completeError.message);
    await admin.from("content_work_items").update({
      status: "researching",
      summary: "NAVER WORKS 원본을 비공개 저장소에 안전하게 보관했습니다. 원본 폰트를 유지하는 슬라이드 이미지 변환을 기다리고 있습니다.",
      review_note: null,
      updated_at: completedAt,
    }).eq("id", job.work_item_id);
    const { error: unlockError } = await admin.from("content_jobs").update({
      status: "queued",
      payload: {
        waitsFor: "download",
        sourceBucket: bucket,
        sourcePath: storagePath,
      },
    }).eq("candidate_id", job.candidate_id).eq("job_type", "convert").eq("status", "on_hold");
    if (unlockError) throw new Error(unlockError.message);

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: "downloaded" as const,
      originalFileName: file.file_name,
      byteLength: bytes.byteLength,
      storagePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "원본 다운로드 실패";
    if (PERMANENT_SIZE_ERROR.test(message)) {
      const { data: candidate } = await admin.from("portfolio_candidates")
        .select("drive_file_id")
        .eq("id", job.candidate_id)
        .maybeSingle();
      if (candidate?.drive_file_id) {
        const { data: file } = await admin.from("naver_works_drive_files")
          .select("id,file_name,file_size")
          .eq("id", candidate.drive_file_id)
          .maybeSingle();
        if (file) {
          return await excludeOversizedSource({
            job,
            file,
            message: "원본 파일이 저장소의 자동 처리 허용 용량을 초과합니다.",
          });
        }
      }
    }
    await admin.from("content_jobs").update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    await admin.from("content_work_items").update({
      status: "on_hold",
      review_note: `원본 다운로드 보류: ${message}`,
      updated_at: new Date().toISOString(),
    }).eq("id", job.work_item_id);
    throw error;
  }
}
