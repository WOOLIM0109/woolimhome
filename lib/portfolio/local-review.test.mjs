import assert from "node:assert/strict";
import test from "node:test";
import { scoreLocalVisualMetrics } from "./local-visual-score.ts";

test("local visual scoring prefers diagram-rich balanced slides", () => {
  const rich = scoreLocalVisualMetrics({
    edgeDensity: 0.15,
    colorRatio: 0.32,
    contrast: 65,
    occupiedRatio: 0.55,
  }, 80);
  const sparse = scoreLocalVisualMetrics({
    edgeDensity: 0.015,
    colorRatio: 0.01,
    contrast: 12,
    occupiedRatio: 0.08,
  }, 20);
  assert.ok(rich.diagramRichness > sparse.diagramRichness);
  assert.ok(rich.visualQuality > sparse.visualQuality);
  assert.ok(rich.rarity > sparse.rarity);
});

test("local visual scores stay inside the documented 0..100 range", () => {
  const scores = scoreLocalVisualMetrics({
    edgeDensity: 4,
    colorRatio: 3,
    contrast: 800,
    occupiedRatio: 2,
  }, 500);
  Object.values(scores).forEach((value) => {
    assert.ok(value >= 0 && value <= 100);
  });
});
