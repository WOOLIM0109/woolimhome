import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerLeaseSeconds } from "@/lib/pc-worker/identity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;

  const requestedSlideCount = Number(body.slideCount || 0);
  const slideCount = Math.min(100, requestedSlideCount);
  if (!body.jobId || !Number.isInteger(slideCount) || slideCount < 5) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
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

  const bucket = "portfolio-rendered";
  const { error: bucketError } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg"],
  });
  if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) {
    return NextResponse.json({ error: bucketError.message }, { status: 500 });
  }
  await admin.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg"],
  });

  const base = `${job.candidate_id}/pc-${job.id}`;
  const specs = Array.from({ length: slideCount }, (_, index) => ({
    kind: "slide",
    index: index + 1,
    path: `${base}/slide-${String(index + 1).padStart(3, "0")}.png`,
    contentType: "image/png",
  }));
  const uploads = [];
  for (const spec of specs) {
    const { data, error } = await admin.storage.from(bucket)
      .createSignedUploadUrl(spec.path, { upsert: true });
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Upload URL failed." }, { status: 500 });
    }
    uploads.push({ ...spec, signedUrl: data.signedUrl });
  }

  return NextResponse.json({
    bucket,
    leaseExpiresAt,
    uploadAuthorization: `Bearer ${anonKey}`,
    uploads,
  });
}
