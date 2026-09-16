/**
 * AI 가 돌려준 초안의 빠진 항목을 채웁니다.
 *
 * 스키마를 주어도 항목 하나가 빠져 오는 일이 있습니다. 그때 코드가 그 자리에서
 * 바로 터지면, 이미 다 쓴 3,500자와 거기까지 쓴 요금이 통째로 사라지고 화면에는
 * "Cannot read properties of undefined (reading 'map')" 만 남습니다.
 * 대표님이 보기에 이건 아무 뜻도 없는 말입니다.
 *
 * 실제로 usedSourceUrls 한 줄이 그렇게 죽였습니다. 바로 아랫줄의
 * usedKnowledgeIds 는 `|| []` 로 막혀 있었는데 윗줄만 빠져 있었습니다.
 * 한 줄씩 막으면 다음에 다른 항목이 빠질 때 또 같은 일이 납니다.
 * 그래서 들어오는 초안을 여기 한 군데에서 정리합니다.
 *
 * 빠진 것을 지어내지는 않습니다. 빈 값으로 두면 뒤의 검사(출처 2개 미만 등)가
 * 걸러 내고, 사람이 읽을 수 있는 말로 보류됩니다. 그게 프로그래머 오류보다 낫습니다.
 */

/** 문자열만 남긴 배열. 숫자나 객체가 섞여 와도 뒤에서 터지지 않게 합니다. */
export function stringList(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export type RawDraft = {
  title?: unknown;
  slug?: unknown;
  excerpt?: unknown;
  category?: unknown;
  contentKind?: unknown;
  audience?: unknown;
  coreMessage?: unknown;
  tags?: unknown;
  bodyHtml?: unknown;
  faqs?: unknown;
  usedSourceUrls?: unknown;
  usedKnowledgeIds?: unknown;
  expertQuestions?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * 초안의 모양을 보장합니다.
 *
 * 값을 고치지는 않습니다. 없는 것을 빈 값으로 두어, 뒤의 코드가 형태를 다시
 * 확인하지 않아도 되게 할 뿐입니다.
 */
export function normalizeDraft(draft: RawDraft) {
  const contentKind = draft.contentKind === "hybrid" || draft.contentKind === "authority"
    ? draft.contentKind
    : "informational";
  return {
    title: text(draft.title),
    slug: text(draft.slug),
    excerpt: text(draft.excerpt),
    category: text(draft.category),
    contentKind,
    audience: text(draft.audience),
    coreMessage: text(draft.coreMessage),
    tags: stringList(draft.tags, 12),
    bodyHtml: text(draft.bodyHtml),
    faqs: Array.isArray(draft.faqs)
      ? draft.faqs
        .filter((faq): faq is Record<string, unknown> => Boolean(faq) && typeof faq === "object")
        .map((faq) => ({ question: text(faq.question), answer: text(faq.answer) }))
        .filter((faq) => faq.question || faq.answer)
        .slice(0, 8)
      : [],
    usedSourceUrls: stringList(draft.usedSourceUrls, 30),
    usedKnowledgeIds: stringList(draft.usedKnowledgeIds, 30),
    expertQuestions: stringList(draft.expertQuestions, 10),
  };
}
