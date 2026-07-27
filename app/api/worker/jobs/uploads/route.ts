import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker } from "@/lib/pc-worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const slideCount = Math.max(1, Math.min(100, Number(body.slideCount || 0)));
  if (!body.jobId || !Number.isFinite(slideCount)) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }
  const admin = contentAdmin();
  const { data: job, error: jobError } = await admin.from("content_jobs")
    .select("id,candidate_id")
    .eq("id", body.jobId)
    .eq("status", "pc_running")
    .single();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 404 });
  const bucket = "portfolio-rendered";
  const { error: bucketError } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
  });
  if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) {
    return NextResponse.json({ error: bucketError.message }, { status: 500 });
  }
  await admin.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
  });

  const base = `${job.candidate_id}/pc-${job.id}`;
  const specs = [
    { kind: "pdf", path: `${base}/presentation.pdf`, contentType: "application/pdf" },
    ...Array.from({ length: slideCount }, (_, index) => ({
      kind: "slide",
      index: index + 1,
      path: `${base}/slide-${String(index + 1).padStart(3, "0")}.png`,
      contentType: "image/png",
    })),
  ];
  const uploads = [];
  for (const spec of specs) {
    const { data, error } = await admin.storage.from(bucket)
      .createSignedUploadUrl(spec.path, { upsert: true });
    if (error || !data) return NextResponse.json({ error: error?.message || "Upload URL failed." }, { status: 500 });
    uploads.push({ ...spec, signedUrl: data.signedUrl });
  }
  return NextResponse.json({ bucket, uploads });
}
