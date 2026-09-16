import type { WorkflowStatus } from "./types";

export type WorkQueueViewItem = {
  channel: string;
  format: string;
  status: WorkflowStatus;
  title: string;
  summary?: string | null;
  source_label?: string | null;
  source_reference?: string | null;
};

export type WorkQueueFilters = {
  query?: string;
  status?: string;
  format?: string;
  channel?: string;
};

export const REVIEW_QUEUE_STATUS: WorkflowStatus = "review_required";

/**
 * 검토 요청 화면과 채널별 작업 화면은 같은 항목을 동시에 보여 주지 않습니다.
 *
 * review_required 는 사람이 완성본을 판단할 차례이므로 검토 요청에만 둡니다.
 * 보류·제작 중·승인 완료·발행 완료 항목은 원래 채널 화면에서 처리합니다.
 */
export function isReviewQueueItem(item: Pick<WorkQueueViewItem, "status">) {
  return item.status === REVIEW_QUEUE_STATUS;
}

export function isChannelWorkspaceItem(item: Pick<WorkQueueViewItem, "status">) {
  return !isReviewQueueItem(item);
}

function searchableText(item: WorkQueueViewItem) {
  return [
    item.title,
    item.summary,
    item.source_label,
    item.source_reference,
  ].filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("ko-KR");
}

/** 검색·상태·종류·채널 조건을 모두 만족하는 작업만 남깁니다. */
export function filterWorkQueueItems<T extends WorkQueueViewItem>(
  items: T[],
  filters: WorkQueueFilters,
) {
  const query = (filters.query || "").trim().toLocaleLowerCase("ko-KR");
  return items.filter((item) => {
    if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.format && filters.format !== "all" && item.format !== filters.format) return false;
    if (filters.channel && filters.channel !== "all" && item.channel !== filters.channel) return false;
    return !query || searchableText(item).includes(query);
  });
}
