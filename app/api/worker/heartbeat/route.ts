import { NextResponse } from "next/server";
import { contentAdmin } from "@/lib/content-ops/data";
import { authorizeWorker, PC_WORKER_ID } from "@/lib/pc-worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const { error } = await contentAdmin().from("content_workers").upsert({
    id: PC_WORKER_ID,
    display_name: "울림 사무실 PC",
    status: body.status === "busy" ? "busy" : body.status === "error" ? "error" : "online",
    current_job_id: body.currentJobId || null,
    last_seen_at: now,
    last_error: body.error || null,
    metadata: {
      computerName: body.computerName || null,
      powerPointVersion: body.powerPointVersion || null,
      workerVersion: body.workerVersion || "1.0.0",
    },
    updated_at: now,
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, serverTime: now });
}
