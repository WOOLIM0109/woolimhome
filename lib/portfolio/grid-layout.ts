export const PORTFOLIO_GRID_CANVAS = { width: 1600, height: 1000 } as const;

export function multiPageGridDimensions(slideCount: number, aspectRatio: number) {
  const count = Math.max(1, Math.min(6, Math.floor(slideCount)));
  const columns = count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const safeRatio = Number.isFinite(aspectRatio) && aspectRatio >= 0.55 && aspectRatio <= 2.2
    ? aspectRatio
    : 16 / 9;
  const maximumCardWidth = Math.floor(PORTFOLIO_GRID_CANVAS.width / columns) - 90;
  const maximumCardHeight = Math.floor(PORTFOLIO_GRID_CANVAS.height / rows) - 90;
  const preferredCardWidth = columns === 3 ? 430 : 620;
  const cardWidth = Math.max(120, Math.min(
    preferredCardWidth,
    maximumCardWidth,
    Math.floor(maximumCardHeight * safeRatio),
  ));
  const cardHeight = Math.round(cardWidth / safeRatio);
  return { columns, rows, cardWidth, cardHeight };
}
