import assert from "node:assert/strict";
import test from "node:test";
import {
  multiPageGridDimensions,
  PORTFOLIO_GRID_CANVAS,
} from "./grid-layout.ts";

for (const [label, ratio] of [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["A4 landscape", 297 / 210],
  ["A4 portrait", 210 / 297],
]) {
  test(`keeps a six-slide ${label} grid inside the canvas`, () => {
    const result = multiPageGridDimensions(6, ratio);
    assert.equal(result.columns, 3);
    assert.equal(result.rows, 2);
    assert.ok((result.cardWidth + 90) * result.columns <= PORTFOLIO_GRID_CANVAS.width);
    assert.ok((result.cardHeight + 90) * result.rows <= PORTFOLIO_GRID_CANVAS.height);
  });
}
