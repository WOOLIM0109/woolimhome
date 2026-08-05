const FIGURE_PATTERN = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;

function appendBeforeTrailingWhitespace(section: string, value: string) {
  const trailing = section.match(/\s*$/)?.[0] || "";
  return `${section.slice(0, section.length - trailing.length)}${value}${trailing}`;
}

function evenlySpacedSectionIndexes(sectionCount: number, figureCount: number) {
  if (sectionCount < figureCount || figureCount < 1) return null;
  const indexes = Array.from({ length: figureCount }, (_, index) => (
    Math.max(0, Math.min(
      sectionCount - 1,
      Math.round(((index + 1) * sectionCount) / (figureCount + 1)) - 1,
    ))
  ));
  return new Set(indexes).size === figureCount ? indexes : null;
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
  const insertions = new Map<number, string>();
  figures.forEach((figure, index) => {
    const point = Math.max(1, Math.round(((index + 1) * paragraphCount) / (figures.length + 1)));
    insertions.set(point, `${insertions.get(point) || ""}${figure}`);
  });
  return withoutFigures.replace(/<\/p>/gi, (closingTag) => {
    paragraphNumber += 1;
    return `${closingTag}${insertions.get(paragraphNumber) || ""}`;
  });
}

