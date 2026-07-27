import { contentAdmin } from "@/lib/content-ops/data";
import {
  cloudConvertFailure,
  createPresentationPdfJob,
  exportedFile,
  getCloudConvertJob,
} from "./client";

const MAX_RENDERED_BYTES = 100 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

type JobResult = {
  cloudConvertJobId?: string;
  bucket?: string;
  storagePath?: string;
  originalFileName?: string;
  [key: string]: unknown;
};

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
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase 저장소 설정이 없습니다.");
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
    throw new Error(`변환본 저장 준비 실패: ${createResponse.status}`);
  }
  const uploadUrl = createResponse.headers.get("location");
  if (!uploadUrl) throw new Error("변환본 업로드 주소가 없습니다.");
  const resolvedUploadUrl = new URL(uploadUrl, endpoint).toString();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const chunk = bytes.slice(offset, Math.min(offset + TUS_CHUNK_BYTES, bytes.byteLength));
    const response = await fetch(resolvedUploadUrl, {
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
    if (response.status !== 204) throw new Error(`변환본 저장 실패: ${response.status}`);
    offset = Number(response.headers.get("upload-offset") || offset + chunk.byteLength);
  }
}

async function failJob(
  job: { id: string; candidate_id: string; work_item_id: string },
  error: unknown,
) {
  const admin = contentAdmin();
  const message = error instanceof Error ? error.message : "문서 변환 실패";
  const permanentFontFailure = /READ_ONLY_FONTS|read-only fonts/i.test(message);
  const now = new Date().toISOString();
  await admin.from("content_jobs").update({
    status: "failed",
    ...(permanentFontFailure ? { attempts: 5 } : {}),
    error_message: message,
    completed_at: now,
  }).eq("id", job.id);
  if (permanentFontFailure) {
    await admin.from("portfolio_candidates").update({
      status: "rejected",
      updated_at: now,
      metadata: {
        rejectedAt: now,
        rejectedReason: "read_only_fonts",
      },
    }).eq("id", job.candidate_id);
  }
  await admin.from("content_work_items").update({
    status: "on_hold",
    summary: permanentFontFailure
      ? "원본에 변환이 제한된 글꼴이 포함되어 자동 제작에서 제외했습니다."
      : "원본 변환 과정에서 오류가 발생해 자동 제작을 보류했습니다.",
    review_note: permanentFontFailure
      ? "원본에 변환이 금지된 읽기 전용 글꼴이 포함되어 자동 제작에서 제외했습니다. 원본 디자인을 훼손하지 않기 위해 대체 글꼴 변환은 하지 않습니다."
      : `문서 변환 보류: ${message}`,
    updated_at: now,
  }).eq("id", job.work_item_id);
}

export async function processNextPortfolioConversion(candidateId?: string) {
  const admin = contentAdmin();
  let query = admin.from("content_jobs")
    .select("id,candidate_id,work_item_id,status,result,payload,attempts")
    .eq("job_type", "convert")
    .in("status", ["queued", "running", "failed"])
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(1);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  const { data: jobs, error: jobError } = await query;
  if (jobError) throw new Error(jobError.message);
  const job = jobs?.[0];
  if (!job) return null;

  try {
    const previousResult = (job.result || {}) as JobResult;
    let cloudJobId = previousResult.cloudConvertJobId;

    if (!cloudJobId) {
      const { data: downloads, error: downloadError } = await admin.from("content_jobs")
        .select("result")
        .eq("candidate_id", job.candidate_id)
        .eq("job_type", "download")
        .eq("status", "completed")
        .limit(1);
      if (downloadError) throw new Error(downloadError.message);
      const source = (downloads?.[0]?.result || {}) as JobResult;
      if (!source.bucket || !source.storagePath || !source.originalFileName) {
        throw new Error("변환할 원본 파일 정보가 없습니다.");
      }
      const { data: signed, error: signedError } = await admin.storage
        .from(source.bucket)
        .createSignedUrl(source.storagePath, 3600);
      if (signedError || !signed?.signedUrl) {
        throw new Error(signedError?.message || "원본 임시 접근 주소 생성 실패");
      }
      const cloudJob = await createPresentationPdfJob({
        sourceUrl: signed.signedUrl,
        fileName: source.originalFileName,
        candidateId: job.candidate_id,
      });
      cloudJobId = cloudJob.id;
      const now = new Date().toISOString();
      await admin.from("content_jobs").update({
        status: "running",
        attempts: Number(job.attempts || 0) + 1,
        started_at: now,
        completed_at: null,
        error_message: null,
        result: {
          ...previousResult,
          cloudConvertJobId: cloudJob.id,
          originalFileName: source.originalFileName,
        },
      }).eq("id", job.id);
      await admin.from("content_work_items").update({
        status: "researching",
        summary: "원본 PPT의 글꼴과 레이아웃을 보존하는 PDF 변환을 진행하고 있습니다.",
        review_note: null,
        updated_at: now,
      }).eq("id", job.work_item_id);
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "running",
        cloudConvertJobId: cloudJob.id,
      };
    }

    const cloudJob = await getCloudConvertJob(cloudJobId);
    if (cloudJob.status === "waiting" || cloudJob.status === "processing") {
      return {
        candidateId: job.candidate_id,
        workItemId: job.work_item_id,
        status: "running",
        cloudConvertJobId: cloudJobId,
      };
    }
    if (cloudJob.status === "error") throw new Error(cloudConvertFailure(cloudJob));

    const output = exportedFile(cloudJob);
    if (!output?.url) throw new Error("CloudConvert 변환 결과 파일을 찾지 못했습니다.");
    const response = await fetch(output.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`변환 결과 다운로드 실패: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RENDERED_BYTES) throw new Error("변환 결과가 100MB를 초과했습니다.");

    const bucket = "portfolio-rendered";
    const { error: createBucketError } = await admin.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: MAX_RENDERED_BYTES,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
    });
    if (createBucketError && !/already exists|duplicate/i.test(createBucketError.message)) {
      throw new Error(createBucketError.message);
    }
    await admin.storage.updateBucket(bucket, {
      public: false,
      fileSizeLimit: MAX_RENDERED_BYTES,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
    });
    const storagePath = `${job.candidate_id}/${crypto.randomUUID()}.pdf`;
    await resumableUpload(bucket, storagePath, bytes, "application/pdf");

    const completedAt = new Date().toISOString();
    await admin.from("content_jobs").update({
      status: "completed",
      completed_at: completedAt,
      error_message: null,
      result: {
        ...previousResult,
        cloudConvertJobId: cloudJobId,
        bucket,
        storagePath,
        byteLength: bytes.byteLength,
        outputFileName: output.filename,
      },
    }).eq("id", job.id);
    await admin.from("content_jobs").update({
      status: "queued",
      payload: {
        waitsFor: "convert",
        renderedBucket: bucket,
        renderedPath: storagePath,
      },
    }).eq("candidate_id", job.candidate_id).eq("job_type", "font_check").eq("status", "on_hold");
    await admin.from("content_work_items").update({
      status: "researching",
      summary: "PPT를 PDF로 변환했습니다. 이제 글꼴과 페이지 구성을 자동 점검합니다.",
      updated_at: completedAt,
    }).eq("id", job.work_item_id);

    return {
      candidateId: job.candidate_id,
      workItemId: job.work_item_id,
      status: "completed",
      storagePath,
      byteLength: bytes.byteLength,
    };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}
