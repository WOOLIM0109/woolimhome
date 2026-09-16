import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerLeaseSeconds } from "@/lib/pc-worker/identity";

export const runtime = "nodejs";

const BUCKET = "portfolio-rendered";
const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg"],
};

/** 한 문서에서 받을 수 있는 최대 장수. 뒤쪽 작업도 같은 수로 자릅니다. */
const MAX_SLIDES = 100;
const MIN_SLIDES = 5;

/**
 * 버킷은 한 번만 만듭니다.
 *
 * 예전에는 요청마다 만들기와 고치기를 불렀습니다. 첫 요청 이후로는 늘 "이미
 * 있다"로 실패할 것을 알면서 부르는 것이라, 업로드 한 번에 스토리지 왕복이
 * 두 번씩 덧붙었습니다.
 */
let bucketReady: Promise<void> | null = null;

function ensureBucket(admin: ReturnType<typeof contentAdmin>) {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const { error } = await admin.storage.createBucket(BUCKET, BUCKET_OPTIONS);
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new Error(error.message);
    }
    await admin.storage.updateBucket(BUCKET, BUCKET_OPTIONS);
  })().catch((error) => {
    // 실패하면 기억을 지워 다음 요청이 다시 시도하게 합니다.
    bucketReady = null;
    throw error;
  });
  return bucketReady;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;

  const requestedSlideCount = Number(body.slideCount || 0);
  if (!body.jobId || !Number.isInteger(requestedSlideCount) || requestedSlideCount < MIN_SLIDES) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }
  const slideCount = Math.min(MAX_SLIDES, requestedSlideCount);
  const truncated = requestedSlideCount > MAX_SLIDES;
  if (truncated) {
    // 예전에는 넘는 만큼이 아무 말 없이 사라졌습니다. 워커도 관리자도
    // 모자란 줄 모른 채 다음 단계로 넘어갔습니다.
    console.warn(
      `[업로드] 작업 ${body.jobId}: 장표 ${requestedSlideCount}장 가운데 ${MAX_SLIDES}장까지만 받습니다.`,
    );
  }

  const admin = contentAdmin();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return NextResponse.json({ error: "Supabase upload authorization is missing." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(
    Date.now() + workerLeaseSeconds(worker) * 1000,
  ).toISOString();
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .update({ lease_expires_at: leaseExpiresAt, updated_at: now })
    .eq("id", body.jobId)
    .eq("job_type", "convert")
    .eq("status", "pc_running")
    .eq("claimed_by_worker_id", worker.id)
    .select("id,candidate_id")
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) {
    return NextResponse.json(
      { error: "This job is no longer assigned to this worker." },
      { status: 409 },
    );
  }

  try {
    await ensureBucket(admin);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bucket preparation failed." },
      { status: 500 },
    );
  }

  const base = `${job.candidate_id}/pc-${job.id}`;
  const specs = Array.from({ length: slideCount }, (_, index) => ({
    kind: "slide",
    index: index + 1,
    path: `${base}/slide-${String(index + 1).padStart(3, "0")}.png`,
    contentType: "image/png",
  }));

  // 백 장이면 왕복도 백 번입니다. 한 번에 보내면 한 번 기다리는 시간으로 끝납니다.
  const signed = await Promise.all(specs.map(async (spec) => {
    const { data, error } = await admin.storage.from(BUCKET)
      .createSignedUploadUrl(spec.path, { upsert: true });
    if (error || !data) throw new Error(error?.message || "Upload URL failed.");
    return { ...spec, signedUrl: data.signedUrl };
  })).catch((error: unknown) => {
    return error instanceof Error ? error : new Error("Upload URL failed.");
  });
  if (signed instanceof Error) {
    return NextResponse.json({ error: signed.message }, { status: 500 });
  }

  return NextResponse.json({
    bucket: BUCKET,
    leaseExpiresAt,
    uploadAuthorization: `Bearer ${anonKey}`,
    uploads: signed,
    // 몇 장을 달라고 했고 몇 장을 주는지 밝힙니다. 잘렸으면 잘렸다고 말합니다.
    requestedSlideCount,
    slideCount,
    ...(truncated ? { truncated: true, maxSlides: MAX_SLIDES } : {}),
  });
}
