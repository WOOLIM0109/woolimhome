import { contentAdmin } from "@/lib/content-ops/data";
import {
  cloudConvertFailure,
  createPdfImagesJob,
  createPresentationPdfJob,
  exportedFile,
  exportedFiles,
  getCloudConvertJob,
} from "./client";

const MAX_RENDERED_BYTES = 50 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

type JobResult = {
  cloudConvertJobId?: string;
  bucket?: string;
  storagePath?: string;
  originalFileName?: string;
  sourceFormat?: "pdf" | "ppt" | "pptx";
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

async function ensureRenderedBucket() {
  const admin = contentAdmin();
  const bucket = "portfolio-rendered";
  const { error: createBucketError } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_RENDERED_BYTES,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
  });
  if (createBucketError && !/already exists|duplicate/i.test(createBucketError.message)) {
    throw new Error(createBucketError.message);
  }
  const { error: updateBucketError } = await admin.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_RENDERED_BYTES,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
  });
  if (updateBucketError) throw new Error(updateBucketError.message);
  return bucket;
}

async function downloadBytes(url: string, label: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label} 다운로드 실패: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RENDERED_BYTES) {
    throw new Error(`${label} 파일이 50MB를 초과했습니다.`);
  }
  return bytes;
}

async function completePdfImageJob(
  job: { id: string; candidate_id: string; work_item_id: string; result: unknown },
  cloudJob: Awaited<ReturnType<typeof getCloudConvertJob>>,
) {
  const admin = contentAdmin();
  const outputs = exportedFiles(cloudJob, "export-images")
    .filter((file) => /\.png$/i.test(file.filename) && file.url)
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))
    .slice(0, 24);
  if (!outputs.length) throw new Error("PDF 페이지 이미지 변환 결과를 찾지 못했습니다.");

  const { data: downloads, error: downloadError } = await admin.from("content_jobs")
    .select("result")
    .eq("candidate_id", job.candidate_id)
    .eq("job_type", "download")
    .eq("status", "completed")
    .limit(1);
  if (downloadError) throw new Error(downloadError.message);
  const source = (downloads?.[0]?.result || {}) as JobResult;
  if (!source.bucket || !source.storagePath) {
    throw new Error("PDF 원본 저장 정보를 찾지 못했습니다.");
  }
  const { data: signed, error: signedError } = await admin.storage
    .from(source.bucket)
    .createSignedUrl(source.storagePath, 1800);
  if (signedError || !signed?.signedUrl) {
    throw new Error(signedError?.message || "PDF 원본 접근 주소 생성 실패");
  }

  const bucket = await ensureRenderedBucket();
  const base = `${job.candidate_id}/pdf-${crypto.randomUUID()}`;
  const pdfBytes = await downloadBytes(signed.signedUrl, "PDF 원본");
  const pdfPath = `${base}/presentation.pdf`;
  await resumableUpload(bucket, pdfPath, pdfBytes, "application/pdf");

  const slidePaths: string[] = [];
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index];
    const bytes = await downloadBytes(output.url, `PDF ${index + 1}페이지`);
    const path = `${base}/slide-${String(index + 1).padStart(3, "0")}.png`;
    await resumableUpload(bucket, path, bytes, "image/png");
    slidePaths.push(path);
  }

  const completedAt = new Date().toISOString();
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: completedAt,
    error_message: null,
    result: {
      ...((job.result || {}) as JobResult),
      bucket,
      storagePath: pdfPath,
      slidePaths,
      slideCount: slidePaths.length,
      sourceFormat: "pdf",
      cloudConvertJobId: cloudJob.id,
    },
    updated_at: completedAt,
  }).eq("id", job.id);
  await admin.from("portfolio_candidates").update({
    status: "processed",
    font_status: "ready",
    updated_at: completedAt,
  }).eq("id", job.candidate_id);
  await admin.from("content_jobs").update({
    status: "completed",
    completed_at: completedAt,
    result: { completedBy: "pdf_source_renderer", completedAt },
    updated_at: completedAt,
  }).eq("candidate_id", job.candidate_id)
    .in("job_type", ["font_check", "privacy_check"])
    .in("status", ["queued", "on_hold"]);
  await admin.from("content_jobs").update({
    status: "queued",
    payload: { waitsFor: "privacy_check", slidePaths, bucket },
    updated_at: completedAt,
  }).eq("candidate_id", job.candidate_id)
    .eq("job_type", "mockup")
    .in("status", ["on_hold", "failed"]);

  const reviewUrls = slidePaths.map((path) =>
    `/api/admin/assets?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`);
  await admin.from("content_review_assets").delete().eq("work_item_id", job.work_item_id);
  await admin.from("content_review_assets").insert(reviewUrls.slice(0, 12).map((url, index) => ({
    work_item_id: job.work_item_id,
    asset_type: index === 0 ? "thumbnail" : "body_image",
    public_url: url,
    sort_order: index,
    approved: false,
    review_note: "PDF 원본 페이지 렌더링 결과",
  })));
  await admin.from("content_work_items").update({
    status: "review_required",
    summary: `함께 제공된 PDF 원본을 우선 사용해 ${slidePaths.length}장의 페이지 이미지를 만들었습니다. 프로젝트 적합성과 사용할 장면을 검토해주세요.`,
    review_note: "PDF 우선 변환 완료. 목업 합성 전 원본 페이지 검토 단계입니다.",
    updated_at: completedAt,
  }).eq("id", job.work_item_id);

  return {
    candidateId: job.candidate_id,
    workItemId: job.work_item_id,
    status: "completed",
    sourceFormat: "pdf",
    slideCount: slidePaths.length,
  };
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
    status: permanentFontFailure ? "pc_waiting" : "failed",
    error_message: message,
    completed_at: permanentFontFailure ? null : now,
    updated_at: now,
  }).eq("id", job.id);
  if (permanentFontFailure) {
    await admin.from("portfolio_candidates").update({
      status: "on_hold",
      updated_at: now,
      metadata: {
        pcWorkerRequiredAt: now,
        pcWorkerReason: "read_only_fonts",
      },
    }).eq("id", job.candidate_id);
  }
  await admin.from("content_work_items").update({
    status: permanentFontFailure ? "researching" : "on_hold",
    summary: permanentFontFailure
      ? "제한 글꼴을 원본 그대로 유지하기 위해 회사 PC의 PowerPoint 변환을 기다리고 있습니다."
      : "원본 변환 과정에서 오류가 발생해 자동 제작을 보류했습니다.",
    review_note: permanentFontFailure
      ? null
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
      const sourceFormat = source.originalFileName.split(".").pop()?.toLowerCase();
      if (!sourceFormat || !["pdf", "ppt", "pptx"].includes(sourceFormat)) {
        throw new Error("지원하지 않는 포트폴리오 원본 형식입니다.");
      }
      const cloudJob = sourceFormat === "pdf"
        ? await createPdfImagesJob({
          sourceUrl: signed.signedUrl,
          fileName: source.originalFileName,
          candidateId: job.candidate_id,
        })
        : await createPresentationPdfJob({
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
          sourceFormat,
        },
      }).eq("id", job.id);
      await admin.from("content_work_items").update({
        status: "researching",
        summary: sourceFormat === "pdf"
          ? "함께 제공된 PDF 원본을 우선 사용해 페이지 이미지를 만들고 있습니다."
          : "원본 PPT의 글꼴과 레이아웃을 보존하는 PDF 변환을 진행하고 있습니다.",
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

    const sourceFormat = previousResult.sourceFormat
      || previousResult.originalFileName?.split(".").pop()?.toLowerCase();
    if (sourceFormat === "pdf") {
      return await completePdfImageJob(job, cloudJob);
    }

    const output = exportedFile(cloudJob);
    if (!output?.url) throw new Error("CloudConvert 변환 결과 파일을 찾지 못했습니다.");
    const response = await fetch(output.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`변환 결과 다운로드 실패: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RENDERED_BYTES) throw new Error("변환 결과가 100MB를 초과했습니다.");

    const bucket = await ensureRenderedBucket();
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
