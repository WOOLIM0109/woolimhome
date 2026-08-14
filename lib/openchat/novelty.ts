function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2),
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? Math.round((intersection / union) * 100) : 0;
}

function keywordOverlap(left: string[], right: string[]) {
  const leftSet = new Set(left.map((value) => value.toLowerCase().replace(/\s+/g, "")).filter(Boolean));
  const rightSet = new Set(right.map((value) => value.toLowerCase().replace(/\s+/g, "")).filter(Boolean));
  const denominator = Math.min(leftSet.size, rightSet.size);
  if (!denominator) return 0;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return Math.round((intersection / denominator) * 70);
}

/**
 * 두 공고가 얼마나 닮았는지 0~100 으로 봅니다.
 *
 * 같은 사업의 지역만 다른 공고, 회차만 다른 공고가 하루 걸러 올라옵니다.
 * 제목과 분류에 쓰인 낱말이 겹치는 정도로 가늠합니다.
 */
export function textSimilarity(left: string, right: string) {
  return jaccard(tokens(left), tokens(right));
}

export function assessHistoricalSimilarity(
  candidate: { title: string; body: string; keywords: string[] },
  history: { id: string; title: string; summary?: string | null; keywords?: string[] | null }[],
) {
  const candidateTokens = tokens(`${candidate.title} ${candidate.body} ${candidate.keywords.join(" ")}`);
  const matches = history
    .map((item) => {
      const textScore = jaccard(candidateTokens, tokens(`${item.title} ${item.summary || ""} ${(item.keywords || []).join(" ")}`));
      const keywordScore = keywordOverlap(candidate.keywords, item.keywords || []);
      return { id: item.id, title: item.title, score: Math.max(textScore, keywordScore) };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  return {
    score: matches[0]?.score || 0,
    matches,
    duplicate: Boolean(matches[0] && matches[0].score >= 48),
  };
}
