/**
 * 본문에 들어간 도식을 다루는 규칙.
 *
 * 도식은 그림 파일이 아니라 그림 그리는 방법을 적은 글입니다. 그래서 본문
 * 안에 그대로 들어갑니다. 덕분에 글자가 깨지지 않고 요금도 들지 않지만,
 * 대신 두 가지를 따로 챙겨야 합니다.
 *
 * 하나는 분량입니다. 도식 안의 라벨까지 본문 글자로 세면, 글을 제대로 쓰지
 * 않고 도식으로 분량을 채울 수 있습니다.
 *
 * 다른 하나는 검색 노출입니다. 사진에는 대체 글(alt)을 답니다. 도식에는 그
 * 자리가 없어서 제목과 설명을 안에 넣습니다. 넣어 달라고 부탁만 하면 언젠가
 * 빠뜨리므로, 빠졌는지 여기서 확인합니다.
 */

/** 켜고 끄는 스위치. 값을 넣지 않으면 꺼진 상태입니다. */
export function diagramsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.COLUMN_DIAGRAMS === "true";
}

/** 도식 구간을 통째로 걷어냅니다. 분량과 문체를 셀 때 씁니다. */
export function stripDiagrams(html: string) {
  return String(html || "").replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
}

export function countDiagrams(html: string) {
  return (String(html || "").match(/<svg\b/gi) || []).length;
}

/**
 * 저장해도 되는 도식인지 봅니다.
 *
 * 앞의 것은 정리기를 거치기 전, 뒤의 것은 거친 뒤입니다. 둘을 견주면 정리기가
 * 무엇을 잘라냈는지 알 수 있습니다. 잘린 채로 저장하면 홈페이지에 반쪽짜리
 * 그림이 나가는데, 그걸 알아채는 사람은 아무도 없습니다.
 */
export function diagramIssues(rawHtml: string, cleanedHtml: string, limit = 1) {
  const before = countDiagrams(rawHtml);
  const after = countDiagrams(cleanedHtml);
  const issues: string[] = [];

  if (before && !after) {
    issues.push("도식이 저장 과정에서 통째로 사라졌습니다. 허용되지 않은 태그를 썼습니다.");
    return issues;
  }
  if (before > after) {
    issues.push(`도식 ${before - after}개가 저장 과정에서 사라졌습니다. 허용되지 않은 태그를 썼습니다.`);
  }
  if (!after) return issues;

  if (after > limit) {
    issues.push(`도식이 ${after}개입니다. 한 편에 ${limit}개까지만 씁니다.`);
  }
  for (const block of cleanedHtml.match(/<svg\b[\s\S]*?<\/svg>/gi) || []) {
    // 크기를 고정하면 좁은 화면에서 잘립니다. viewbox 만으로 비율을 잡습니다.
    if (!/\bviewbox\s*=/i.test(block)) {
      issues.push("도식에 viewBox 가 없습니다. 좁은 화면에서 잘립니다.");
    }
    // 사진의 대체 글에 해당합니다. 없으면 검색에도 안 잡히고 읽어 주지도 못합니다.
    if (!/<title\b[^>]*>\s*\S/i.test(block)) {
      issues.push("도식에 제목(title)이 없습니다. 검색 노출과 화면 낭독에 필요합니다.");
    }
    if (!/<desc\b[^>]*>\s*\S/i.test(block)) {
      issues.push("도식에 설명(desc)이 없습니다. 검색 노출과 화면 낭독에 필요합니다.");
    }
    // 글자가 하나도 없으면 그림이 아니라 색칠한 상자에 지나지 않습니다.
    if (!/<text\b[^>]*>\s*\S/i.test(block)) {
      issues.push("도식에 글자가 하나도 없습니다. 무엇을 나타내는지 알 수 없습니다.");
    }
  }
  return [...new Set(issues)];
}
