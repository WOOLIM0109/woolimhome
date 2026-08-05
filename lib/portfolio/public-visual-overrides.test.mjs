import assert from "node:assert/strict";
import test from "node:test";
import { portfolioPublicVisualOverrides } from "./public-visual-overrides.ts";

test("tourism portfolio exposes only the three administrator-approved visuals", () => {
  assert.deepEqual(
    portfolioPublicVisualOverrides("0f567175-4389-459b-827e-d1e54ca52282"),
    [
      { sourceSlideNumber: 1, shapeId: 2557 },
      { sourceSlideNumber: 3, shapeId: 6 },
      { sourceSlideNumber: 13, shapeId: 9 },
    ],
  );
  assert.deepEqual(portfolioPublicVisualOverrides("unknown"), []);
});
