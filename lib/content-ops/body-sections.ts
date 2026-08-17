/**
 * 본문을 소제목 단위로 나누기
 *
 * 말투를 다듬을 때 원고 전체를 한 번에 인공지능에 넘기고 있었습니다.
 * 그러다 보니 긴 원고에서 답이 끝을 맺지 못하고 잘렸고, 그 한 번의 실패로
 * 원고 전체가 손도 못 댄 채 남았습니다. 실제로 오늘 아홉 건 중 네 건이
 * 그렇게 넘어갔습니다.
 *
 * 그래서 소제목을 경계로 잘라 한 덩이씩 맡깁니다.
 * 한 덩이가 실패해도 그 덩이만 원문을 쓰고 나머지는 다듬어집니다.
 * 답이 짧아지니 잘릴 일도 크게 줄어듭니다.
 *
 * 잘린 덩이가 너무 잘면 요청 횟수만 늘어납니다.
 * 그래서 작은 덩이는 옆 덩이와 붙여 적당한 크기로 맞춥니다.
 */

/** 소제목이 시작하는 자리. 태그 이름이 h2 로 끝나는 것만 봅니다. */
const HEADING_OPEN = /<h2(?=[\s>])/gi;

/** 한 덩이가 최소한 이만큼의 글자를 담도록 붙입니다. */
export const SECTION_MIN_PLAIN_LENGTH = 700;

/** 한 원고를 나눌 수 있는 최대 덩이 수. 요청 횟수의 상한입니다. */
export const SECTION_MAX_COUNT = 8;

/** 태그를 걷어낸 순수 글자 수 */
export function plainTextLength(value: string) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s/g, "").length;
}

/**
 * 소제목마다 잘라 돌려줍니다.
 *
 * 첫 소제목 앞의 도입부도 하나의 덩이가 됩니다.
 * 소제목이 없으면 통째로 한 덩이입니다.
 */
export function splitBodySections(bodyHtml: string) {
  const value = String(bodyHtml || "");
  if (!value.trim()) return [];
  const starts: number[] = [];
  HEADING_OPEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_OPEN.exec(value))) starts.push(match.index);
  if (!starts.length) return [value];

  const sections: string[] = [];
  if (starts[0] > 0) sections.push(value.slice(0, starts[0]));
  for (let index = 0; index < starts.length; index += 1) {
    sections.push(value.slice(starts[index], starts[index + 1] ?? value.length));
  }
  return sections.filter((section) => section.trim());
}

/**
 * 작은 덩이를 옆 덩이에 붙여 덩이 수를 줄입니다.
 *
 * @param minPlainLength 한 덩이가 담아야 할 최소 글자 수
 * @param maxCount 넘지 않아야 할 덩이 수
 */
export function mergeSmallSections(
  sections: string[],
  minPlainLength = SECTION_MIN_PLAIN_LENGTH,
  maxCount = SECTION_MAX_COUNT,
) {
  const merged: string[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && plainTextLength(previous) < minPlainLength) {
      merged[merged.length - 1] = previous + section;
      continue;
    }
    merged.push(section);
  }
  // 마지막 덩이가 홀로 짧게 남으면 앞 덩이에 붙입니다.
  while (merged.length > 1 && plainTextLength(merged[merged.length - 1]) < minPlainLength) {
    const tail = merged.pop()!;
    merged[merged.length - 1] += tail;
  }
  // 그래도 덩이가 많으면 뒤에서부터 합쳐 상한에 맞춥니다.
  while (merged.length > maxCount) {
    const tail = merged.pop()!;
    merged[merged.length - 1] += tail;
  }
  return merged;
}

/** 나눈 덩이를 원래대로 되붙입니다. */
export function joinBodySections(sections: string[]) {
  return sections.join("");
}

/** 나누고 붙이기까지 한 번에 */
export function bodySectionsForRewrite(bodyHtml: string) {
  return mergeSmallSections(splitBodySections(bodyHtml));
}
