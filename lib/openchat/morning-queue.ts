// 오전 오픈챗에 내보낼 공고를 고르는 부분입니다. 데이터베이스를 건드리지
// 않습니다 — 그래야 시험에서 그대로 불러 확인할 수 있습니다.
//
// 줄을 채우는 쪽은 lib/openchat/operations.ts 의 queueMorningPrograms 입니다.
import { normalizeText } from "./utils.ts";

type QueueCandidate = {
  id: string;
  applicant_summary?: string | null;
  deadline_at?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

/**
 * 줄에 세울 공고를 고릅니다. 데이터베이스를 건드리지 않는 순수한 부분이라
 * 따로 떼어 두었습니다 — 여기서 틀리면 그날 게시문이 비거나 지난 공고가 나갑니다.
 */
export function pickQueueCandidates(
  rows: QueueCandidate[], options: { now: number; limit: number; carried: number },
) {
  const ready = rows.filter((row) => {
    const deadline = row.deadline_at ? Date.parse(row.deadline_at) : null;
    // 마감이 지난 것과 날짜를 못 읽는 것은 내보내지 않습니다.
    if (row.deadline_at && (deadline === null || Number.isNaN(deadline) || deadline < options.now)) return false;
    // 신청대상이 비어 있으면 게시문이 빈칸으로 나갑니다. 줄에 세우지 않습니다.
    return normalizeText(row.applicant_summary || "").length >= 10;
  });
  // 행사·교육으로 보이는 것은 뒤로 밉니다. 버리지는 않습니다.
  // (sort 는 같은 값끼리 순서를 지키므로, 들어온 마감 순서가 그대로 남습니다.)
  const ordered = [...ready].sort((left, right) =>
    Number(Boolean((left.raw_payload || {}).event_like)) - Number(Boolean((right.raw_payload || {}).event_like)));
  // 하루 건수보다 넉넉히 세워 둡니다. 겹치는 것을 골라내고 남는 것은 다음 영업일로 넘어갑니다.
  // 이월된 것이 이미 자리를 차지하고 있으면 그만큼 적게 세웁니다.
  const room = Math.max(0, options.limit * 4 - options.carried);
  return { picked: ordered.slice(0, room), skippedNoApplicant: rows.length - ready.length };
}
