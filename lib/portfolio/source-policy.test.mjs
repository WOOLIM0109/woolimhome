import assert from "node:assert/strict";
import test from "node:test";
import { isPdfPortfolioSource } from "./source-policy.ts";

test("recognizes PDF conversion results without relying on a file name", () => {
  assert.equal(isPdfPortfolioSource({ sourceFormat: "pdf" }), true);
  assert.equal(isPdfPortfolioSource({ sourceFormat: "PDF" }), true);
});

test("recognizes PDF downloads and leaves PowerPoint eligible for manifest refresh", () => {
  assert.equal(isPdfPortfolioSource({ originalFileName: "proposal.PDF" }), true);
  assert.equal(isPdfPortfolioSource({ originalFileName: "proposal.pptx" }), false);
  assert.equal(isPdfPortfolioSource({ sourceFormat: "pptx" }), false);
});
