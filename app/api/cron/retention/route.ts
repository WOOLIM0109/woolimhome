import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { surveyRetention } from "@/lib/retention/survey";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 보존 정책 집계.
 *
 * 지금은 아무것도 지우지 않습니다. 정책을 켜면 무엇이 얼마나 정리될지
 * 숫자만 남깁니다. 2주쯤 돌려 실제 규모를 보고 기간을 확정한 뒤에
 * 삭제를 붙입니다.
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const admin = createAdminClient();
  const dateKey = now.toISOString().slice(0, 10);

  // 하루에 한 번만 기록하게, 다른 크론과 같은 방식으로 자리를 잡습니다.
  const { data: runId, error: claimError } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "retention-survey",
    p_schedule_key: dateKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 300,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!runId) return NextResponse.json({ skipped: true, reason: "오늘 집계는 이미 기록했습니다" });

  try {
    const survey = await surveyRetention(now);
    await admin.from("content_automation_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      metrics: survey,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json(survey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "보존 정책 집계 실패";
    await admin.from("content_automation_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
