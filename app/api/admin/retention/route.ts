import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { RETENTION_RULES } from "@/lib/retention/policy";
import type { RetentionPurgeReport } from "@/lib/retention/purge";

export const dynamic = "force-dynamic";

/** 화면에 보여 줄 지난 실행 기록 수. */
const HISTORY = 14;

type RunRow = {
  schedule_key: string;
  status: string;
  scheduled_for: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  metrics: unknown;
};

function asReport(metrics: unknown): RetentionPurgeReport | null {
  if (!metrics || typeof metrics !== "object") return null;
  const value = metrics as Partial<RetentionPurgeReport>;
  return Array.isArray(value.entries) ? value as RetentionPurgeReport : null;
}

/**
 * 보존 정책이 무엇을 지웠는지 보여 줍니다.
 *
 * 지금까지는 크론이 지우기만 하고 그 결과를 Supabase 화면에서 직접 찾아봐야
 * 알 수 있었습니다. 되돌릴 수 없는 일을 자동으로 하는 만큼, 무엇이 지워졌고
 * 무엇이 막혔는지는 관리자 화면에서 바로 보여야 합니다.
 */
export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await contentAdmin()
    .from("content_automation_runs")
    .select("schedule_key,status,scheduled_for,started_at,completed_at,error_message,metrics")
    .eq("cron_name", "retention")
    .order("scheduled_for", { ascending: false })
    .limit(HISTORY);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runs = ((data || []) as RunRow[]).map((run) => {
    const report = asReport(run.metrics);
    return {
      scheduleKey: run.schedule_key,
      status: run.status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      errorMessage: run.error_message,
      totals: report?.totals || null,
      entries: (report?.entries || []).map((entry) => ({
        key: entry.key,
        label: entry.label,
        action: entry.action,
        afterDays: entry.afterDays,
        rows: entry.rows,
        files: entry.files || 0,
        remaining: Boolean(entry.remaining),
        warnings: entry.warnings || [],
        error: entry.error || null,
      })),
    };
  });

  return NextResponse.json({
    runs,
    // 정책 자체도 함께 내려 줍니다. 아직 한 번도 돌지 않았어도 무엇을 언제
    // 지우기로 해 두었는지는 화면에서 확인할 수 있어야 합니다.
    policy: RETENTION_RULES.map((rule) => ({
      key: rule.key,
      label: rule.label,
      action: rule.action,
      afterDays: rule.afterDays,
      basis: rule.basis,
      guard: rule.guard,
    })),
  }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
