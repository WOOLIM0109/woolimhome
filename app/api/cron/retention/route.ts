import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { purgeRetention } from "@/lib/retention/purge";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 보존 정책 실행.
 *
 * 하루 한 번 돌면서 정책에 걸린 데이터를 지웁니다. 규칙마다 상한이 있어
 * 한 번에 다 지우지 않습니다. 남은 것이 있으면 결과에 remaining 으로
 * 표시되고 다음 실행에서 이어서 처리합니다.
 *
 * 무엇을 어떤 조건으로 지우는지는 lib/retention/policy.ts 한 곳에 있습니다.
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const admin = createAdminClient();
  const dateKey = now.toISOString().slice(0, 10);

  // 하루에 한 번만 돌게, 다른 크론과 같은 방식으로 자리를 잡습니다.
  // 두 번 돌아도 지운 것을 또 지울 뿐이라 위험하지는 않지만, 기록이 겹칩니다.
  const { data: runId, error: claimError } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "retention",
    p_schedule_key: dateKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 600,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!runId) return NextResponse.json({ skipped: true, reason: "오늘 정리는 이미 실행했습니다" });

  try {
    const report = await purgeRetention(now);
    await admin.from("content_automation_runs").update({
      // 한 규칙이라도 막혔으면 완료로 적지 않습니다. 조용히 넘어가면 안 됩니다.
      status: report.totals.failed ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      metrics: report,
      ...(report.totals.failed
        ? { error_message: `${report.totals.failed}개 규칙이 실패했습니다.` }
        : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "보존 정책 실행 실패";
    await admin.from("content_automation_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
