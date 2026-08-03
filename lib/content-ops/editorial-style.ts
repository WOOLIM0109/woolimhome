export const FRIENDLY_EDITORIAL_STYLE_RULES = `
공통 문체와 강조 규칙:
- 비개발자 기업 담당자에게 옆에서 설명하듯 친근하고 자연스러운 한국어로 쓴다.
- 사실과 공식 조건은 차분하게 설명하고, 실무 조언에는 "확인해 보세요", "좋습니다", "괜찮아요" 같은 표현을 자연스럽게 섞는다.
- 글 전체에서 느낌표는 1~4회, 독자에게 말을 거는 짧은 질문은 1~3회만 사용한다. 이모지는 사용하지 않는다.
- "오늘날", "빠르게 변화하는", "살펴보겠습니다", "결론적으로", "단순한 A를 넘어 B", "A가 아니라 B입니다"처럼 AI가 반복해서 쓰는 상투적 문장을 피한다.
- "중요합니다", "필수적입니다", "기대할 수 있습니다" 같은 추상적 종결을 연속으로 사용하지 않는다.
- 의미 없는 도입과 요약을 줄이고, 구체적인 상황·판단 기준·실행 순서가 바로 드러나게 쓴다.
- 각 본문 문단에서 독자가 찾아야 할 핵심어 1~2개만 <strong>으로 강조한다. 문장 전체나 문단 전체는 굵게 만들지 않는다.
- FAQ 질문과 답변 데이터에는 Q. 또는 A. 접두어를 직접 넣지 않는다. 화면과 복사 원고에서 시스템이 한 번만 붙인다.
- FAQ 답변에서도 꼭 필요한 핵심어만 <strong>으로 강조할 수 있다.
`;

const FAQ_PREFIX = /^\s*(?:<strong>\s*)?[QA]\s*[.．:：]\s*(?:<\/strong>\s*)?/i;

export function stripFaqPrefix(value: string) {
  const source = String(value || "").trim();
  const fullyWrapped = source.match(/^<strong>\s*[QA]\s*[.．:：]\s*([\s\S]*?)<\/strong>$/i);
  if (fullyWrapped) return fullyWrapped[1].trim();
  return source.replace(FAQ_PREFIX, "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeInlineStrongHtml(value: string) {
  const source = stripFaqPrefix(value);
  const parts: string[] = [];
  let cursor = 0;
  const strongPattern = /<strong>([\s\S]*?)<\/strong>/gi;
  for (const match of source.matchAll(strongPattern)) {
    const index = match.index || 0;
    parts.push(escapeHtml(source.slice(cursor, index)));
    parts.push(`<strong>${escapeHtml(match[1].replace(/<[^>]+>/g, ""))}</strong>`);
    cursor = index + match[0].length;
  }
  parts.push(escapeHtml(source.slice(cursor)));
  return parts.join("");
}

export function faqQuestionHtml(value: string) {
  const plain = stripFaqPrefix(value).replace(/<[^>]+>/g, "");
  return `<strong>Q. ${escapeHtml(plain)}</strong>`;
}

export function faqAnswerHtml(value: string) {
  return `A. ${safeInlineStrongHtml(value)}`;
}

export function friendlyStyleIssues(bodyHtml: string) {
  const paragraphCount = (bodyHtml.match(/<p[\s>]/gi) || []).length;
  const strongCount = (bodyHtml.match(/<strong[\s>]/gi) || []).length;
  const plain = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const clicheCount = [
    /오늘날/g,
    /빠르게 변화하는/g,
    /살펴보겠습니다/g,
    /결론적으로/g,
    /단순(?:한|히).{0,24}넘어/g,
    /중요합니다/g,
    /필수적입니다/g,
    /기대할 수 있습니다/g,
  ].reduce((total, pattern) => total + (plain.match(pattern) || []).length, 0);
  const issues: string[] = [];
  if (strongCount < Math.min(5, Math.max(3, Math.floor(paragraphCount / 3)))) {
    issues.push("본문 핵심어 볼드가 부족합니다.");
  }
  if (paragraphCount && strongCount > paragraphCount * 2) {
    issues.push("본문 볼드가 너무 많습니다.");
  }
  if (clicheCount > 2) issues.push("AI 상투 표현이 반복됩니다.");
  return issues;
}
