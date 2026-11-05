export const COMPARISON_WAIVER_REASONS = [
  { value: "not_portfolio", label: "포트폴리오 글이 아님" },
  { value: "source_unavailable", label: "원본이 더 이상 없음" },
  { value: "duplicate_record", label: "이미 다른 기록과 같은 건" },
] as const;

export type ComparisonWaiverReason = typeof COMPARISON_WAIVER_REASONS[number]["value"];
export type ComparisonWaiverEvent = {
  action: "waive" | "restore";
  reason: ComparisonWaiverReason;
  actor: string;
  at: string;
};

export function isComparisonWaiverReason(value: unknown): value is ComparisonWaiverReason {
  return COMPARISON_WAIVER_REASONS.some(reason => reason.value === value);
}

export function comparisonWaiverHistory(value: unknown): ComparisonWaiverEvent[] {
  if (!Array.isArray(value)) return [];
  const events: ComparisonWaiverEvent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !["waive", "restore"].includes(entry.action)
      || !isComparisonWaiverReason(entry.reason) || typeof entry.actor !== "string" || !entry.actor.trim()
      || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at))) return [];
    events.push({ action: entry.action, reason: entry.reason, actor: entry.actor, at: entry.at });
  }
  return events;
}

export function activeComparisonWaiver(value: unknown): ComparisonWaiverEvent | null {
  const last = comparisonWaiverHistory(value).at(-1);
  return last?.action === "waive" ? last : null;
}
