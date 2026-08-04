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
