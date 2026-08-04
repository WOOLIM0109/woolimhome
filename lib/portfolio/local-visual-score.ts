export type LocalVisualMetrics = {
  edgeDensity: number;
  colorRatio: number;
  contrast: number;
  occupiedRatio: number;
};

function clampScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function scoreLocalVisualMetrics(
  metrics: LocalVisualMetrics,
  rarity: number,
) {
  const edge = clampScore((metrics.edgeDensity / 0.18) * 100);
  const color = clampScore((metrics.colorRatio / 0.42) * 100);
  const contrast = clampScore((metrics.contrast / 72) * 100);
  const occupied = clampScore((metrics.occupiedRatio / 0.72) * 100);
  const balance = clampScore(100 - Math.abs(metrics.occupiedRatio - 0.52) * 150);
  return {
    diagramRichness: clampScore(edge * 0.55 + color * 0.2 + occupied * 0.25),
    visualQuality: clampScore(contrast * 0.4 + balance * 0.35 + color * 0.25),
    rarity: clampScore(rarity),
    textDensity: clampScore(edge * 0.7 + occupied * 0.3 - color * 0.18),
  };
}
