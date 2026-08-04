import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authenticateWorker } from "@/lib/pc-worker/auth";
import { workerLeaseSeconds } from "@/lib/pc-worker/identity";
import { retryMissingFontCandidates } from "@/lib/pc-worker/font-retry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const authentication = authenticateWorker(request, body);
  if (authentication.response) return authentication.response;
  const { worker } = authentication;
  const admin = contentAdmin();
  const now = new Date().toISOString();
  let leaseExpiresAt: string | null = null;
  const currentJobId = typeof body.currentJobId === "string" && body.currentJobId
    ? body.currentJobId
    : null;
  const fontInventoryFingerprint = typeof body.fontInventoryFingerprint === "string"
    ? body.fontInventoryFingerprint.trim().slice(0, 128)
    : null;

  if (currentJobId) {
    leaseExpiresAt = new Date(
      Date.now() + workerLeaseSeconds(worker) * 1000,
    ).toISOString();
    const { data: leasedJob, error: leaseError } = await admin.from("content_jobs").update({
      lease_expires_at: leaseExpiresAt,
      updated_at: now,
    })
      .eq("id", currentJobId)
      .eq("job_type", "convert")
      .eq("status", "pc_running")
      .eq("claimed_by_worker_id", worker.id)
      .select("id")
      .maybeSingle();
    if (leaseError) return NextResponse.json({ error: leaseError.message }, { status: 500 });
    if (!leasedJob) {
      return NextResponse.json(
        { error: "This job is no longer assigned to this worker." },
        { status: 409 },
      );
    }
  }

  const { data: previousWorker, error: previousWorkerError } = await admin.from("content_workers")
    .select("font_inventory_fingerprint")
    .eq("id", worker.id)
    .maybeSingle();
  if (previousWorkerError) return NextResponse.json({ error: previousWorkerError.message }, { status: 500 });
  let fontRetry = { requeued: 0, candidateIds: [] as string[] };
  if (fontInventoryFingerprint && previousWorker?.font_inventory_fingerprint !== fontInventoryFingerprint) {
    fontRetry = await retryMissingFontCandidates(fontInventoryFingerprint);
  }

  const { error } = await admin.from("content_workers").upsert({
    id: worker.id,
    display_name: worker.displayName,
    status: body.status === "busy" ? "busy" : body.status === "error" ? "error" : "online",
    current_job_id: currentJobId,
    last_seen_at: now,
    last_error: body.error || null,
    font_inventory_fingerprint: fontInventoryFingerprint,
    metadata: {
      computerName: body.computerName || null,
      powerPointVersion: body.powerPointVersion || null,
      workerVersion: body.workerVersion || "1.0.0",
    },
    updated_at: now,
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    workerId: worker.id,
    serverTime: now,
    leaseExpiresAt,
    fontsRequeued: fontRetry.requeued,
  });
}
