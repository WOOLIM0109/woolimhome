import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { PC_WORKER_ID } from "@/lib/pc-worker/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  const [{ data: worker, error }, { count: waitingCount }] = await Promise.all([
    admin.from("content_workers")
      .select("id,display_name,status,current_job_id,last_seen_at,last_error,metadata")
      .eq("id", PC_WORKER_ID)
      .maybeSingle(),
    admin.from("content_jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "convert")
      .eq("status", "pc_waiting"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lastSeen = worker?.last_seen_at ? new Date(worker.last_seen_at).getTime() : 0;
  const online = Boolean(lastSeen && Date.now() - lastSeen < 3 * 60 * 1000);
  return NextResponse.json({
    configured: Boolean(process.env.PC_WORKER_SECRET),
    worker: worker ? { ...worker, status: online ? worker.status : "offline" } : null,
    online,
    waitingCount: waitingCount || 0,
    nextRunHint: "화·금 오전 9시 · 오전 8시 30분까지 PC 로그인 권장",
  });
}
