export const PORTFOLIO_WRITING_RULES = `
포트폴리오 글 이미지 배치 규칙:
- 대표 썸네일은 목록 카드에서만 사용하고 본문용 이미지와 섞지 않는다.
- 본문용 이미지는 글 상단에 한꺼번에 나열하지 않는다.
- 각 이미지는 그 이미지를 설명하는 문단 바로 다음에 figure로 배치한다.
- figure 안에는 img와 figcaption을 함께 넣는다.
- 연속된 figure를 만들지 않고, 이미지 사이에는 반드시 설명 문단이나 소제목을 둔다.
- 메인 콜라주, 정보 구조, 분석, 실행 전략처럼 서로 다른 역할의 이미지를 고른다.
- 같은 슬라이드 형식이나 같은 내용을 반복해서 보여주지 않는다.
`;

export function validatePortfolioBodyHtml(bodyHtml: string) {
  const issues: string[] = [];
  const figureCount = (bodyHtml.match(/<figure[\s>]/gi) || []).length;
  const imageCount = (bodyHtml.match(/<img[\s>]/gi) || []).length;

  if (figureCount < 3) issues.push("본문용 이미지가 3개 미만입니다.");
  if (figureCount !== imageCount) issues.push("본문 이미지는 모두 figure 안에 배치해야 합니다.");
  if (/<\/figure>\s*<figure[\s>]/i.test(bodyHtml)) {
    issues.push("본문 이미지가 설명 없이 연속으로 배치되어 있습니다.");
  }
  if (figureCount && !/<p[\s>][\s\S]*?<\/p>\s*<figure[\s>]/i.test(bodyHtml)) {
    issues.push("이미지는 관련 설명 문단 다음에 배치해야 합니다.");
  }

  return issues;
}
