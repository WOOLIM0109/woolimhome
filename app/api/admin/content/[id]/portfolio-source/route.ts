import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const runtime = "nodejs";
export const maxDuration = 300;

const SOURCE_BUCKET = "portfolio-sources";
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const SOURCE_MIME_TYPES = [
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  "application/octet-stream",
];
const EXTENSION_MIME_TYPES: Record<string, string> = {
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
};

type PortfolioSourceRequest = {
  action?: "prepare" | "commit";
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  uploadId?: string;
};

function safeFileName(value: string) {
  const normalized = value.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return normalized.slice(0, 180) || "portfolio-source.pptx";
}

function sourceExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function sourcePath(workItemId: string, uploadId: string, fileName: string) {
  return `legacy-sources/${workItemId}/${uploadId}/${safeFileName(fileName)}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasPowerPointSignature(bytes: Uint8Array, extension: string) {
  if (extension === "ppt") {
    return bytes.length >= 8
      && bytes[0] === 0xd0
      && bytes[1] === 0xcf
      && bytes[2] === 0x11
      && bytes[3] === 0xe0;
  }
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && bytes[2] === 0x03
    && bytes[3] === 0x04;
}

async function ensureSourceBucket() {
  const admin = contentAdmin();
  const { error: createError } = await admin.storage.createBucket(SOURCE_BUCKET, {
    public: false,
    fileSizeLimit: MAX_SOURCE_BYTES,
    allowedMimeTypes: SOURCE_MIME_TYPES,
  });
  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error(createError.message);
  }
  const { error: updateError } = await admin.storage.updateBucket(SOURCE_BUCKET, {
    public: false,
    fileSizeLimit: MAX_SOURCE_BYTES,
    allowedMimeTypes: SOURCE_MIME_TYPES,
  });
  if (updateError) throw new Error(updateError.message);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as PortfolioSourceRequest;
  const fileName = safeFileName(String(body.fileName || ""));
  const extension = sourceExtension(fileName);
  const fileSize = Number(body.fileSize || 0);
  if (!Object.hasOwn(EXTENSION_MIME_TYPES, extension)) {
    return NextResponse.json({ error: "PPT, PPTX 또는 PPTM 원본만 연결할 수 있습니다." }, { status: 400 });
  }
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "원본 파일 크기가 허용 범위를 벗어났습니다." }, { status: 400 });
  }

  const admin = contentAdmin();
  const { data: workItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,channel,format,title,status,summary,source_label,source_reference,review_note,metadata,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (workItemError) return NextResponse.json({ error: workItemError.message }, { status: 500 });
  if (!workItem) return NextResponse.json({ error: "작업물을 찾지 못했습니다." }, { status: 404 });
  if (workItem.channel !== "naver_design" || workItem.format !== "portfolio") {
    return NextResponse.json({ error: "디자인 포트폴리오 작업만 원본을 연결할 수 있습니다." }, { status: 400 });
  }
  if (workItem.status === "published") {
    return NextResponse.json({ error: "발행 완료 작업은 원본을 다시 연결할 수 없습니다." }, { status: 409 });
  }

  const metadata = workItem.metadata && typeof workItem.metadata === "object"
    ? workItem.metadata as Record<string, unknown>
    : {};
  const uploadMetadata = metadata.portfolioSourceUpload && typeof metadata.portfolioSourceUpload === "object"
    ? metadata.portfolioSourceUpload as Record<string, unknown>
    : {};
  if (body.action === "commit"
    && uploadMetadata.uploadId === body.uploadId
    && typeof metadata.candidateId === "string") {
    return NextResponse.json({
      ok: true,
      alreadyCommitted: true,
      candidateId: metadata.candidateId,
      status: workItem.status,
    });
  }
  if (typeof metadata.candidateId === "string" && metadata.candidateId) {
    return NextResponse.json({ error: "이미 연결된 포트폴리오 원본이 있습니다." }, { status: 409 });
  }
  const { data: linkedJob, error: linkedJobError } = await admin
    .from("content_jobs")
    .select("candidate_id")
    .eq("work_item_id", id)
    .not("candidate_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (linkedJobError) return NextResponse.json({ error: linkedJobError.message }, { status: 500 });
  if (linkedJob?.candidate_id) {
    return NextResponse.json({ error: "이미 연결된 포트폴리오 변환 작업이 있습니다." }, { status: 409 });
  }

  if (body.action === "prepare") {
    await ensureSourceBucket();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      return NextResponse.json({ error: "원본 업로드 인증 설정이 없습니다." }, { status: 500 });
    }
    const uploadId = randomUUID();
    const path = sourcePath(id, uploadId, fileName);
    const { data, error } = await admin.storage
      .from(SOURCE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "원본 업로드 주소를 만들지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json({
      uploadId,
      uploadUrl: data.signedUrl,
      contentType: EXTENSION_MIME_TYPES[extension],
      uploadAuthorization: `Bearer ${anonKey}`,
    });
  }

  if (body.action !== "commit" || typeof body.uploadId !== "string" || !isUuid(body.uploadId)) {
    return NextResponse.json({ error: "원본 연결 요청이 올바르지 않습니다." }, { status: 400 });
  }

  const path = sourcePath(id, body.uploadId, fileName);
  const { data: sourceBlob, error: sourceError } = await admin.storage
    .from(SOURCE_BUCKET)
    .download(path);
  if (sourceError || !sourceBlob) {
    return NextResponse.json({ error: sourceError?.message || "업로드한 원본을 확인하지 못했습니다." }, { status: 409 });
  }
  const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
  if (bytes.byteLength !== fileSize || !hasPowerPointSignature(bytes, extension)) {
    await admin.storage.from(SOURCE_BUCKET).remove([path]);
    return NextResponse.json({ error: "업로드한 파일이 원본 PowerPoint와 일치하지 않습니다." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  let driveFileId: string | null = null;
  let workItemUpdated = false;
  try {
    const { data: driveFile, error: driveFileError } = await admin.from("naver_works_drive_files").insert({
      root_id: null,
      external_file_id: `local-admin:${id}:${fingerprint}`,
      parent_file_id: null,
      file_path: `관리자 직접 연결/${fileName}`,
      file_name: fileName,
      file_extension: extension,
      file_type: "file",
      file_size: bytes.byteLength,
      modified_at: now,
      fingerprint,
      supported: true,
      sync_status: "queued",
      raw_metadata: {
        source: "admin_portfolio_upload",
        workItemId: id,
        uploadId: body.uploadId,
        uploadedBy: user.email,
      },
      last_seen_at: now,
      updated_at: now,
    }).select("id").single();
    if (driveFileError) throw new Error(driveFileError.message);
    driveFileId = driveFile.id;

    const { data: candidate, error: candidateError } = await admin.from("portfolio_candidates").insert({
      drive_file_id: driveFile.id,
      project_key: `admin-upload-${id}`,
      project_name: workItem.title,
      status: "on_hold",
      quality_score: 0,
      duplicate_score: 0,
      privacy_risk: "unknown",
      font_status: "unchecked",
      selection_reasons: ["관리자가 기존 포트폴리오에 원본 PowerPoint를 직접 연결함"],
      exclusion_reasons: [],
      metadata: {
        workItemId: id,
        localAdminUpload: true,
        sourceFingerprint: fingerprint,
        sourceFileName: fileName,
        sourceStorageBucket: SOURCE_BUCKET,
        sourceStoragePath: path,
        uploadId: body.uploadId,
        selectedAt: now,
      },
      updated_at: now,
    }).select("id").single();
    if (candidateError) throw new Error(candidateError.message);

    const steps = ["download", "convert", "font_check", "privacy_check", "mockup", "draft"] as const;
    const jobs = steps.map((jobType, index) => ({
      candidate_id: candidate.id,
      work_item_id: id,
      job_type: jobType,
      // Keep conversion unpublished until the work item no longer has a
      // protected approval state. This prevents a fast worker from completing
      // against the legacy approved snapshot.
      status: jobType === "download" ? "completed" : "on_hold",
      attempts: 0,
      payload: {
        stepOrder: index + 1,
        waitsFor: index ? steps[index - 1] : null,
        sourceDelivery: "supabase_storage",
      },
      result: jobType === "download" ? {
        delivery: "supabase_storage",
        bucket: SOURCE_BUCKET,
        storagePath: path,
        originalFileName: fileName,
        byteLength: bytes.byteLength,
        fingerprint,
      } : {},
      completed_at: jobType === "download" ? now : null,
      updated_at: now,
    }));
    const { error: jobsError } = await admin.from("content_jobs").insert(jobs);
    if (jobsError) throw new Error(jobsError.message);

    const { data: updatedWorkItem, error: updateError } = await admin.from("content_work_items").update({
      status: "researching",
      summary: "관리자가 연결한 원본 PowerPoint를 사무실 PC에서 안전하게 변환하고 있습니다.",
      source_label: "울림컴퍼니 실제 프로젝트 · 관리자 연결 원본",
      source_reference: fileName,
      review_note: null,
      metadata: {
        ...metadata,
        candidateId: candidate.id,
        driveFileId: driveFile.id,
        sourceFileName: fileName,
        sourcePath: `관리자 직접 연결/${fileName}`,
        pipeline: steps,
        portfolioSourceUpload: {
          uploadId: body.uploadId,
          bucket: SOURCE_BUCKET,
          path,
          fingerprint,
          fileName,
          fileSize: bytes.byteLength,
          connectedAt: now,
          connectedBy: user.email,
        },
      },
      updated_at: now,
    }).eq("id", id)
      .eq("updated_at", workItem.updated_at)
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updatedWorkItem) throw new Error("작업물 상태가 바뀌어 원본 연결을 중단했습니다.");
    workItemUpdated = true;

    const { data: queuedConversion, error: queueError } = await admin.from("content_jobs").update({
      status: "pc_waiting",
      updated_at: now,
    }).eq("candidate_id", candidate.id)
      .eq("job_type", "convert")
      .eq("status", "on_hold")
      .select("id")
      .maybeSingle();
    if (queueError) throw new Error(queueError.message);
    if (!queuedConversion) throw new Error("PC 변환 대기열에 원본을 등록하지 못했습니다.");

    return NextResponse.json({
      ok: true,
      workItemId: id,
      candidateId: candidate.id,
      status: "pc_waiting",
      fileName,
      fileSize: bytes.byteLength,
    });
  } catch (error) {
    if (workItemUpdated) {
      await admin.from("content_work_items").update({
        status: workItem.status,
        summary: workItem.summary,
        source_label: workItem.source_label,
        source_reference: workItem.source_reference,
        review_note: workItem.review_note,
        metadata,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "researching").eq("updated_at", now);
    }
    if (driveFileId) await admin.from("naver_works_drive_files").delete().eq("id", driveFileId);
    await admin.storage.from(SOURCE_BUCKET).remove([path]);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "원본을 연결하지 못했습니다.",
    }, { status: 500 });
  }
}
