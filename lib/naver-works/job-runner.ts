import { contentAdmin } from "@/lib/content-ops/data";
import { downloadSharedDriveFile } from "./client";

const MAX_SOURCE_BYTES = 75 * 1024 * 1024;

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

export async function processNextPortfolioDownload(candidateId?: string) {
  const admin = contentAdmin();
  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,payload,attempts")
    .eq("job_type", "download")
    .in("status", ["queued", "failed"])
    .lt("attempts", 3)
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
    if (Number(file.file_size || 0) > MAX_SOURCE_BYTES) {
      throw new Error("원본 파일이 자동 처리 상한인 75MB를 초과합니다.");
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
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error("다운로드된 원본이 75MB를 초과합니다.");

    const bucket = "portfolio-source";
    const { error: bucketError } = await admin.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: MAX_SOURCE_BYTES,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
    });
    if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) {
      throw new Error(bucketError.message);
    }
    const storagePath = `${job.candidate_id}/${safeStorageName(file.file_name)}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, bytes, {
      contentType: contentType(file.file_name),
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

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
      originalFileName: file.file_name,
      byteLength: bytes.byteLength,
      storagePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "원본 다운로드 실패";
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
