import assert from "node:assert/strict";
import test from "node:test";
import { scoreLocalVisualMetrics } from "./local-visual-score.ts";
import { classifyPortfolioClientCategoryFromSourceHint } from "./client-category.ts";

test("does not infer customer size from company-name tokens", () => {
  for (const sourceHint of [
    "현대실업 제안서",
    "CJ 연구개발 제안서",
    "삼성동 소재 제조업체 회사소개서",
    "HDC 컨설팅 발표자료",
    "사옥 인테리어 공사 입찰제안서",
    "산업공단 입주기업 안내서",
  ]) {
    assert.equal(classifyPortfolioClientCategoryFromSourceHint(sourceHint), "unknown");
  }
});

test("uses a customer class only when the source states it explicitly", () => {
  assert.equal(
    classifyPortfolioClientCategoryFromSourceHint("대기업 납품 제안서"),
    "large_company",
  );
  assert.equal(
    classifyPortfolioClientCategoryFromSourceHint("공공기관 관광마케팅 발표자료"),
    "public_institution",
  );
  assert.equal(
    classifyPortfolioClientCategoryFromSourceHint("충남 지자체 관광 전략"),
    "public_institution",
  );
});

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
