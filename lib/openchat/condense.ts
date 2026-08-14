/**
 * 공고 요약을 사람이 읽는 한 줄로 줄이기
 *
 * 수집한 원문은 "ㅇ 공고일 기준 설립일로부터 만 7년 이내 ... * 단, ..." 처럼
 * 기호와 단서가 겹겹이 붙어 있습니다. 그대로 내보내면 한 건에 화면이 넘어갑니다.
 *
 * 그래서 그날 내보낼 다섯 건을 한 번에 묶어 한 줄씩으로 줄입니다.
 * 하루 한 번만 부르므로 지출에 주는 부담이 작습니다.
 * 없는 사실을 만들지 않도록, 원문에 있는 말만 줄이라고 못 박습니다.
 */

export type CondenseInput = {
  id: string;
  title: string;
  applicantSummary: string;
  supportSummary: string;
};

export type CondensedProgram = {
  id: string;
  target: string;
  support: string;
};

/** 한 줄 요약의 최대 길이. 넘으면 읽는 사람이 다시 접습니다. */
export const CONDENSED_MAX_LENGTH = 110;

export function condensePrompt(programs: CondenseInput[]) {
  return `당신은 정부지원사업 공고를 오픈채팅방에 알리는 편집자다.

아래 공고 각각에 대해 두 줄을 만든다.
  target : 누가 신청할 수 있는지. 업력·지역·업종처럼 판단에 필요한 조건만 남긴다.
  support: 무엇을 받는지. 금액과 핵심 지원만 남긴다.

규칙
- 원문에 있는 말만 쓴다. 없는 사실을 만들지 않는다.
- 각 줄은 ${CONDENSED_MAX_LENGTH}자 이내의 한 문장으로 쓴다. 문장 끝에 마침표를 찍지 않는다.
- "ㅇ", "*", "-", "※", "자세한 내용은 공고문 참조" 같은 표시와 안내는 넣지 않는다.
- 원문에 없어 판단할 수 없으면 빈 문자열을 쓴다.
- 선정이나 대출을 보장하는 표현은 쓰지 않는다.

다음 JSON 배열 하나만 반환한다.
[{"id": "공고 id", "target": "...", "support": "..."}]

[공고]
${JSON.stringify(programs)}`;
}

/** 한 줄로 다듬은 뒤에도 남는 기호와 길이를 마지막으로 손봅니다. */
export function tidyLine(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/[※]/g, " ")
    .replace(/^[\s\-•ㅇ○*]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
  return text.length > CONDENSED_MAX_LENGTH ? `${text.slice(0, CONDENSED_MAX_LENGTH).trim()}…` : text;
}

/** 모델이 돌려준 값을 믿을 수 있는 모양으로 거릅니다. */
export function normalizeCondensed(value: unknown, allowedIds: string[]): CondensedProgram[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const rows: CondensedProgram[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!allowed.has(id) || seen.has(id)) continue;
    const target = tidyLine(record.target);
    const support = tidyLine(record.support);
    if (!target && !support) continue;
    seen.add(id);
    rows.push({ id, target, support });
  }
  return rows;
}
