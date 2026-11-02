import { createAdminClient } from "@/lib/supabase/admin";
import { sendAdminPush } from "@/lib/notify/web-push";
import { portfolioStallState } from "@/lib/portfolio/stall-state";

const NOTICE_BUDGET_MS = 12_000;
const FINALIZE_RESERVE_MS = 2_000;
const PAGE_SIZE = 50;

export type PortfolioStallNoticeResult = {
  stage: "portfolio_stall_notice";
  checked: number;
  sent: number;
  failed: number;
  errors: string[];
  deferred?: boolean;
};

/** 기존 시간별 실행에서 확인하고, 작업물별 KST 하루에 한 번 알립니다. */
export async function notifyStalledPortfolios(
  now = new Date(),
  options: { deadlineAt?: number } = {},
): Promise<PortfolioStallNoticeResult> {
  const result: PortfolioStallNoticeResult = {
    stage: "portfolio_stall_notice", checked: 0, sent: 0, failed: 0, errors: [],
  };
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + NOTICE_BUDGET_MS);
  const workDeadlineAt = deadlineAt - FINALIZE_RESERVE_MS;
  const signal = (deadline: number) => AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const admin = createAdminClient();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (let offset = 0; Date.now() < workDeadlineAt; offset += PAGE_SIZE) {
    const { data, error } = await admin.from("content_work_items")
      .select("id,title,status,review_note,metadata,updated_at,portfolio_jobs:content_jobs(id,job_type)")
      .eq("channel", "naver_design").eq("format", "portfolio")
      .in("portfolio_jobs.job_type", ["mockup", "draft"])
      .order("updated_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(signal(workDeadlineAt));
    if (error) throw new Error(error.message);
    if (!data?.length) return result;

    for (const item of data) {
      if (Date.now() >= workDeadlineAt) return { ...result, deferred: true };
      result.checked += 1;
      const stalled = portfolioStallState(item, now);
      if (!stalled) continue;

      let runId: string | null = null;
      let sent = false;
      let failure: string | null = null;
      try {
        const claim = await admin.rpc("claim_content_automation_run", {
          p_cron_name: "portfolio_stall_notice",
          p_schedule_key: `${kstDate}:${item.id}`,
          p_scheduled_for: now.toISOString(),
          p_lease_seconds: 600,
        }).abortSignal(signal(workDeadlineAt));
        if (claim.error) throw new Error(claim.error.message);
        runId = claim.data;
        if (!runId) continue;

        const push = await sendAdminPush({
          title: "포트폴리오가 멈췄습니다",
          body: `${item.title} — ${stalled.reason}, ${stalled.days}일째`,
          url: `/admin/naver-design#work-item-${encodeURIComponent(item.id)}`,
        }, { deadlineAt: workDeadlineAt });
        sent = push.sent > 0;
        if (!sent) failure = push.skipped || "관리자 기기에 알림을 보내지 못했습니다.";
      } catch (error) {
        failure = error instanceof Error ? error.message : "포트폴리오 멈춤 알림 실패";
      }

      if (runId) {
        try {
          const completedAt = new Date().toISOString();
          const { error: closeError } = await admin.from("content_automation_runs").update({
            status: sent ? "completed" : "failed",
            completed_at: completedAt,
            updated_at: completedAt,
            error_message: failure,
            metrics: { workItemId: item.id, reason: stalled.reason, days: stalled.days },
          }).eq("id", runId).eq("status", "running").abortSignal(signal(deadlineAt));
          if (closeError) throw new Error(closeError.message);
        } catch (error) {
          failure = [failure, error instanceof Error ? error.message : "알림 기록 마감 실패"]
            .filter(Boolean).join("; ");
        }
      }
      if (sent) result.sent += 1;
      if (failure) {
        result.failed += 1;
        result.errors.push(`${item.title}: ${failure}`);
      }
    }
    if (data.length < PAGE_SIZE) return result;
  }
  return { ...result, deferred: true };
}
