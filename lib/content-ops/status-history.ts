import type { WorkflowStatus } from "./types";

/**
 * 상태가 바뀔 때마다 한 줄씩 쌓습니다.
 *
 * 표에는 created_at, updated_at, published_at 뿐입니다. updated_at 은
 * 덮어씁니다 — 마지막에 무엇을 만졌는지만 알려 주고, "언제 검토요청이
 * 됐는지" 는 남지 않습니다.
 *
 * 그래서 「어제 10시 글이 왜 안 나왔지」를 알아보려면 매번 저장소에 직접
 * 질의해야 했습니다. 화면에는 답이 없었습니다.
 *
 * 칸을 늘리지 않는 이유가 있습니다. approved_at, reviewed_at 처럼 칸을
 * 만들면 단계가 하나 늘 때마다 표를 고쳐야 하고, 되돌린 기록(승인 → 보류 →
 * 다시 승인)은 덮여서 사라집니다. 무슨 일이 있었는지가 남아야 합니다.
 */

export type StatusChange = {
  status: WorkflowStatus;
  at: string;
  by: string;
};

/** 카드가 길어지지 않게 최근 것만 남깁니다. 되돌린 기록까지 세어 넉넉히 잡습니다. */
const HISTORY_LIMIT = 40;

function isStatusChange(value: unknown): value is StatusChange {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.status === "string" && typeof item.at === "string";
}

/** 지금까지 쌓인 기록. 모양이 이상한 것은 버립니다. */
export function statusHistoryOf(metadata: unknown): StatusChange[] {
  if (!metadata || typeof metadata !== "object") return [];
  const stored = (metadata as Record<string, unknown>).statusHistory;
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(isStatusChange)
    .map((item) => ({ status: item.status, at: item.at, by: typeof item.by === "string" ? item.by : "" }));
}

/**
 * 기록 한 줄을 더한 metadata 를 돌려줍니다. 원래 값은 건드리지 않습니다.
 *
 * 같은 상태를 다시 쓰는 일이 잦습니다. 검토 화면에서 메모만 고쳐도 상태를
 * 함께 보내기 때문입니다. 그때마다 줄이 늘면 기록이 금세 쓸모없어집니다.
 * 마지막 줄과 같은 상태면 시각만 새로 씁니다.
 */
export function appendStatusChange(
  metadata: unknown,
  status: WorkflowStatus,
  by: string,
  at = new Date().toISOString(),
): Record<string, unknown> {
  const base = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const history = statusHistoryOf(base);
  const last = history[history.length - 1];
  const entry: StatusChange = { status, at, by: by || "" };
  const next = last && last.status === status
    ? [...history.slice(0, -1), { ...entry, at: last.at }]
    : [...history, entry];
  return { ...base, statusHistory: next.slice(-HISTORY_LIMIT) };
}

/** 화면에 적을 이름. 사람이 한 것과 자동으로 된 것을 가릅니다. */
export function actorLabel(by: string) {
  if (!by) return "";
  return by.endsWith("@woolimcompany.kr") && by.startsWith("automation") ? "자동" : by;
}
