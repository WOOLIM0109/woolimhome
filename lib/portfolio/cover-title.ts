/**
 * 목업 표지 문구 — 추천 · 선택 · 직접 수정 · 학습
 *
 * 지금까지는 파일명에서 키워드 8개를 찾아 문구를 자동으로 확정했습니다.
 * 걸리는 키워드가 없으면 "비즈니스 비즈니스 문서 디자인" 같은 문구가 나왔고,
 * 사람이 고칠 방법도 없었습니다.
 *
 * 이 파일은 문구를 확정하지 않고 후보를 만들어 관리자가 고르게 합니다.
 * 관리자가 고르거나 직접 쓴 문구는 다음 추천에 예시로 반영되어,
 * 같은 성격의 문서에서 손댈 일이 점점 줄어듭니다.
 */

export type CoverTitleSource = "manual" | "selected" | "auto";

export type CoverTitleRecord = {
  title: string;
  source: CoverTitleSource;
  /** 어떤 성격의 문서였는지. 다음 추천을 고를 때 씁니다. */
  signature: string;
  savedAt: string;
};

const MAX_TITLE_LENGTH = 40;

/** 문서 성격을 한 줄로 요약합니다. 같은 성격끼리 과거 선택을 재사용하기 위한 값입니다. */
export function coverTitleSignature(input: {
  industry?: string | null;
  documentType?: string | null;
  clientCategory?: string | null;
}) {
  return [input.clientCategory || "", input.industry || "", input.documentType || ""]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

/** 사람이 쓸 수 있는 문구인지 확인합니다. */
export function normalizeCoverTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > MAX_TITLE_LENGTH) return null;
  return text;
}

/** 같은 낱말이 이어서 반복되는 문구를 걸러냅니다. "비즈니스 비즈니스 문서" 같은 경우입니다. */
export function hasRepeatedWord(value: string) {
  const words = value.split(" ").filter(Boolean);
  return words.some((word, index) => index > 0 && words[index - 1] === word)
    || words.some((word, index) => index > 0 && word.startsWith(words[index - 1]) && words[index - 1].length >= 2);
}

/**
 * 표지 문구 후보를 만듭니다.
 *
 * @param base       기존 규칙이 만든 문구 (걸러질 수 있음)
 * @param parts      문서에서 읽어낸 조각들
 * @param pastTitles 과거에 관리자가 고르거나 직접 쓴 문구
 */
export function suggestCoverTitles(input: {
  base?: string | null;
  parts: {
    clientPrefix?: string | null;
    subject?: string | null;
    documentType?: string | null;
    projectName?: string | null;
  };
  pastTitles?: CoverTitleRecord[];
  signature?: string;
}): string[] {
  const { parts } = input;
  const candidates: string[] = [];

  // 1순위: 같은 성격의 문서에서 관리자가 이미 고른 문구
  const sameSignature = (input.pastTitles || [])
    .filter((record) => record.signature && record.signature === input.signature)
    .filter((record) => record.source !== "auto");
  for (const record of sameSignature) candidates.push(record.title);

  // 2순위: 문서에서 읽어낸 조각으로 만든 문구
  const prefix = parts.clientPrefix?.trim() || "";
  const subject = parts.subject?.trim() || "";
  const documentType = parts.documentType?.trim() || "";
  if (subject && documentType) candidates.push([prefix, subject, documentType, "디자인"].filter(Boolean).join(" "));
  if (documentType) candidates.push([prefix, documentType, "디자인"].filter(Boolean).join(" "));
  if (subject) candidates.push([prefix, subject, "자료 디자인"].filter(Boolean).join(" "));

  // 3순위: 최근에 관리자가 쓴 문구 (성격이 달라도 말투 참고용)
  for (const record of (input.pastTitles || []).filter((item) => item.source === "manual")) {
    candidates.push(record.title);
  }

  // 4순위: 기존 규칙이 만든 문구
  if (input.base) candidates.push(input.base);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeCoverTitle(candidate);
    if (!normalized || seen.has(normalized)) continue;
    // 같은 낱말이 반복되는 문구는 후보에서 뺍니다.
    if (hasRepeatedWord(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 3) break;
  }

  // 후보를 하나도 만들지 못하면 문서 이름을 그대로 씁니다.
  if (!result.length) {
    const fallback = normalizeCoverTitle(parts.projectName) || "포트폴리오 디자인";
    result.push(fallback);
  }
  return result;
}

/** 저장할 기록을 만듭니다. */
export function coverTitleRecord(
  title: string,
  source: CoverTitleSource,
  signature: string,
  savedAt: string,
): CoverTitleRecord {
  return { title, source, signature, savedAt };
}

/** 과거 기록을 최신순으로 유지하며 같은 문구는 하나만 남깁니다. */
export function mergeCoverTitleHistory(
  history: CoverTitleRecord[],
  record: CoverTitleRecord,
  limit = 20,
) {
  const merged = [record, ...history.filter((item) => item.title !== record.title)];
  return merged.slice(0, limit);
}

export function parseCoverTitleHistory(value: unknown): CoverTitleRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CoverTitleRecord => {
    if (!item || typeof item !== "object") return false;
    const record = item as Partial<CoverTitleRecord>;
    return typeof record.title === "string"
      && typeof record.signature === "string"
      && typeof record.savedAt === "string"
      && (record.source === "manual" || record.source === "selected" || record.source === "auto");
  });
}
