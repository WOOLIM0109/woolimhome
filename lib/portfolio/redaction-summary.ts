/**
 * 이 장표에서 무엇을 왜 가렸는지 사람이 읽을 수 있게 정리합니다.
 *
 * 지금까지는 가린 영역의 '개수'만 남았습니다. 그래서 결과를 보고도 왜 뿌옇게
 * 됐는지 알 방법이 없었고, 규칙이 틀렸을 때 어디를 고쳐야 하는지도 알 수
 * 없었습니다. 담당자가 "과한 블러라기보다 기준을 알 수 없는 블러"라고 한 것이
 * 정확한 표현입니다.
 *
 * 가림은 앞으로도 가끔 틀립니다. 사람이 그것을 짚어낼 수 있어야 고칠 수 있고,
 * 짚어내려면 근거가 보여야 합니다.
 */

/** 워커가 붙인 영역 종류를 사람 말로 옮깁니다. */
export const REDACTION_REASON_LABELS: Record<string, string> = {
  client_identifier: "고객사·기관 이름",
  project_identifier: "프로젝트 이름",
  small_text: "잔글씨 (각주·출처)",
  footer: "바닥글",
  logo: "로고·워터마크",
  // 그림은 lib/portfolio/image-role.ts 가 정한 역할이 그대로 사유가 됩니다.
  person_photo: "사람이 찍힌 사진",
  artwork: "작업물",
  embedded_photo: "사진",
  screenshot: "화면 캡처",
  body_text: "본문",
  table_content: "표 내용",
  chart_label: "차트 라벨",
  contact: "연락처",
  address: "주소",
  registration_number: "사업자등록번호",
  person_name: "사람 이름",
  personal_information: "개인정보",
};

export function redactionReasonLabel(reason: string) {
  return REDACTION_REASON_LABELS[reason] || reason;
}

export type RedactionSummaryEntry = {
  reason: string;
  label: string;
  count: number;
};

/**
 * 사유별로 몇 군데를 가렸는지 셉니다. 많이 가린 사유가 앞에 옵니다.
 *
 * 같은 수면 이름 순으로 정렬해, 같은 입력이면 언제나 같은 결과가 나오게 합니다.
 */
export function summarizeRedactions(reasons: string[]): RedactionSummaryEntry[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: redactionReasonLabel(reason), count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

/** "로고·워터마크 3곳 · 잔글씨 2곳" 처럼 한 줄로 적습니다. */
export function describeRedactions(entries: RedactionSummaryEntry[]) {
  if (!entries.length) return "가린 곳 없음";
  return entries.map((entry) => `${entry.label} ${entry.count}곳`).join(" · ");
}
