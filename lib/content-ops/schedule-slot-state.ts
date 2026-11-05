type SchedulePlan = {
  key: string;
  scheduleKey: string;
  dateKey: string;
  hour: number;
  channel: string;
  format: string;
};

export type ScheduleAutomationRun = {
  scheduled_for: string;
  metrics: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function emptyPortfolioSlotReason(
  plan: SchedulePlan,
  hasWorkItem: boolean,
  runs: readonly ScheduleAutomationRun[],
  now: Date,
): string | null {
  const scheduledAt = Date.parse(`${plan.dateKey}T${String(plan.hour).padStart(2, "0")}:00:00+09:00`);
  if (hasWorkItem || plan.channel !== "naver_design" || plan.format !== "portfolio"
    || !Number.isFinite(scheduledAt) || scheduledAt >= now.getTime()) return null;

  const latest = [...runs].sort((a, b) => Date.parse(b.scheduled_for) - Date.parse(a.scheduled_for));
  for (const run of latest) {
    const runAt = Date.parse(run.scheduled_for);
    if (!Number.isFinite(runAt) || runAt > now.getTime()
      || new Date(runAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) !== plan.dateKey) continue;
    const progress = record(run.metrics)?.localProgress;
    if (!Array.isArray(progress)) continue;
    for (const value of [...progress].reverse()) {
      const entry = record(value);
      if (entry?.stage !== "deterministic_portfolio_prepare"
        || (entry.status !== "skipped" && entry.status !== "failed")) continue;
      if (typeof entry.scheduleKey === "string" && entry.scheduleKey !== plan.scheduleKey) continue;
      if (typeof entry.slotKey === "string" && entry.slotKey !== plan.key) continue;
      const reason = typeof entry.reason === "string" && entry.reason.trim()
        ? entry.reason.trim() : typeof entry.error === "string" ? entry.error.trim() : "";
      if (reason) return reason;
    }
  }
  return "예정 시각 이후 준비 결과가 없습니다.";
}
