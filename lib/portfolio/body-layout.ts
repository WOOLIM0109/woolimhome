/**
 * 본문에 박힌 그림 덩어리를 찾는 규칙.
 *
 * 그림을 갈아 끼우는 쪽에서도 같은 기준을 써야 자리 수가 어긋나지 않습니다.
 * 전역 정규식은 마지막 위치를 기억하므로, 쓸 때마다 새로 만들어 돌려줍니다.
 */
export function portfolioFigurePattern() {
  return /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
}

const FIGURE_PATTERN = portfolioFigurePattern();

function appendBeforeTrailingWhitespace(section: string, value: string) {
  const trailing = section.match(/\s*$/)?.[0] || "";
  return `${section.slice(0, section.length - trailing.length)}${value}${trailing}`;
}

function evenlySpacedSectionIndexes(sectionCount: number, figureCount: number) {
  if (sectionCount < figureCount || figureCount < 1) return null;
  let previous = -1;
  return Array.from({ length: figureCount }, (_, index) => {
    const remaining = figureCount - index - 1;
    const ideal = Math.round(((index + 1) * sectionCount) / (figureCount + 1)) - 1;
    const placement = Math.max(
      previous + 1,
      Math.min(ideal, sectionCount - remaining - 1),
    );
    previous = placement;
    return placement;
  });
}

export function reflowPortfolioBodyFigures(bodyHtml: string) {
  const figures = bodyHtml.match(FIGURE_PATTERN) || [];
  if (!figures.length) return bodyHtml;

  const withoutFigures = bodyHtml.replace(FIGURE_PATTERN, "");
  const firstHeading = withoutFigures.search(/<h2\b/i);
  const preamble = firstHeading > 0 ? withoutFigures.slice(0, firstHeading) : "";
  const sectionHtml = firstHeading >= 0 ? withoutFigures.slice(firstHeading) : withoutFigures;
  const sections = sectionHtml.split(/(?=<h2\b)/i).filter(Boolean);
  const eligible = sections
    .map((section, index) => ({ index, hasParagraph: /<\/p>/i.test(section) }))
    .filter((entry) => entry.hasParagraph);
  const placementIndexes = evenlySpacedSectionIndexes(eligible.length, figures.length);

  if (placementIndexes) {
    placementIndexes.forEach((eligibleIndex, figureIndex) => {
      const sectionIndex = eligible[eligibleIndex].index;
      sections[sectionIndex] = appendBeforeTrailingWhitespace(sections[sectionIndex], figures[figureIndex]);
    });
    return `${preamble}${sections.join("")}`;
  }

  let paragraphNumber = 0;
  const paragraphCount = (withoutFigures.match(/<\/p>/gi) || []).length;
  const paragraphPlacementIndexes = evenlySpacedSectionIndexes(paragraphCount, figures.length);
  const insertions = new Map<number, string>();
  figures.forEach((figure, index) => {
    const point = paragraphPlacementIndexes
      ? paragraphPlacementIndexes[index] + 1
      : Math.max(1, Math.round(((index + 1) * paragraphCount) / (figures.length + 1)));
    insertions.set(point, `${insertions.get(point) || ""}${figure}`);
  });
  return withoutFigures.replace(/<\/p>/gi, (closingTag) => {
    paragraphNumber += 1;
    return `${closingTag}${insertions.get(paragraphNumber) || ""}`;
  });
}


/**
 * 본문의 그림만 새 주소로 갈아 끼웁니다.
 *
 * 예전에는 저장해 둔 그림 목록과 본문의 주소를 하나하나 맞춰 봤습니다.
 * 원본을 다시 변환해 목업 장수가 달라지거나 주소가 어긋나면 통째로 실패했고,
 * '이미지만 다시 만들기'를 아무리 눌러도 같은 오류만 반복됐습니다.
 *
 * 그래서 본문에 실제로 박혀 있는 그림을 정본으로 삼아 앞에서부터 순서대로 끼웁니다.
 * 새 그림이 모자라면 남는 자리는 설명까지 통째로 뺍니다.
 * 그림 없이 설명만 남으면 읽는 사람에게 더 어색합니다.
 * 새 그림이 더 많으면 기존 글은 그대로 둔 채 부족한 figure만 만들어
 * 본문의 설명 문단 사이에 고르게 다시 배치합니다.
 *
 * 바꿀 그림을 하나도 못 찾으면 null 을 돌려줍니다. 이때는 글부터 다시 만들어야 합니다.
 */
export type PortfolioBodyImageReplacement = Readonly<{
  url: string;
  caption?: string;
}>;

function replacementValue(value: string | PortfolioBodyImageReplacement) {
  return typeof value === "string" ? { url: value, caption: "" } : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replacementFigure(replacement: PortfolioBodyImageReplacement, index: number) {
  const caption = replacement.caption?.trim() || `포트폴리오 목업 ${index + 1}`;
  const safeCaption = escapeHtml(caption);
  return `<figure><img src="${escapeHtml(replacement.url)}" alt="${safeCaption}">`
    + `<figcaption>${safeCaption}</figcaption></figure>`;
}

export function swapPortfolioBodyImages(
  bodyHtml: string,
  nextImages: Array<string | PortfolioBodyImageReplacement>,
) {
  if (typeof bodyHtml !== "string" || !bodyHtml.trim() || !nextImages.length) return null;
  const replacements = nextImages.map(replacementValue);

  // 주소에 $ 가 들어가도 치환 기호로 읽히지 않게 합니다.
  const swapSource = (tag: string, nextUrl: string) => tag.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*["'])[^"']*(["'])/i,
    `$1${nextUrl.replaceAll("$", "$$$$")}$2`,
  );

  let used = 0;
  let value = bodyHtml.replace(portfolioFigurePattern(), (figure) => {
    if (!/<img\b/i.test(figure)) return figure;
    const replacement = replacements[used];
    used += 1;
    return replacement ? swapSource(figure, replacement.url) : "";
  });

  if (!used) {
    // 그림이 <figure> 로 감싸이지 않은 예전 본문입니다. 그림만 순서대로 바꿉니다.
    value = bodyHtml.replace(/<img\b[^>]*>/gi, (tag) => {
      const replacement = replacements[used];
      used += 1;
      return replacement ? swapSource(tag, replacement.url) : "";
    });
  }
  if (!used) return null;
  const missingFigures = replacements
    .slice(used)
    .map((replacement, index) => replacementFigure(replacement, used + index))
    .join("");
  return {
    bodyHtml: reflowPortfolioBodyFigures(`${value}${missingFigures}`),
    replaced: replacements.length,
  };
}
