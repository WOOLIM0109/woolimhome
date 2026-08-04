import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { summarizeWorkers, type ContentWorkerRecord } from "@/lib/pc-worker/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  const [workerResult, waitingResult] = await Promise.all([
    admin.from("content_workers")
      .select("id,display_name,status,current_job_id,last_seen_at,last_error,metadata")
      .order("last_seen_at", { ascending: false }),
    admin.from("content_jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "convert")
      .eq("status", "pc_waiting"),
  ]);

  const error = workerResult.error || waitingResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary = summarizeWorkers(
    (workerResult.data || []) as ContentWorkerRecord[],
  );
  const legacyAuthenticationEnabled = process.env.PC_WORKER_ALLOW_LEGACY?.trim().toLowerCase()
    !== "false";

  return NextResponse.json({
    configured: Boolean(
      process.env.PC_WORKER_SECRETS
      || (legacyAuthenticationEnabled && process.env.PC_WORKER_SECRET),
    ),
    ...summary,
    workerCount: summary.workers.length,
    // 이전 단일 PC 화면과의 호환을 위해 가장 최근 PC도 함께 제공합니다.
    worker: summary.workers[0] || null,
    waitingCount: waitingResult.count || 0,
    nextRunHint: "화·금 오전 9시 · 사용할 PC는 오전 8시 30분까지 로그인 권장",
  });
}
