export type PortfolioPublicVisualOverride = {
  sourceSlideNumber: number;
  shapeId: number;
};

const APPROVED_PUBLIC_VISUALS: Record<string, PortfolioPublicVisualOverride[]> = {
  // Public-sector tourism portfolio. These are presentation visuals approved
  // by the administrator for publication: the cover landscape, the public
  // tourism map, and the large destination photograph on slide 13.
  "0f567175-4389-459b-827e-d1e54ca52282": [
    { sourceSlideNumber: 1, shapeId: 2557 },
    { sourceSlideNumber: 3, shapeId: 6 },
    { sourceSlideNumber: 13, shapeId: 9 },
  ],
};

export function portfolioPublicVisualOverrides(candidateId: string) {
  return (APPROVED_PUBLIC_VISUALS[candidateId] || []).map((item) => ({ ...item }));
}
