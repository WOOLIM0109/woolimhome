import assert from "node:assert/strict";
import test from "node:test";
import {
  areNearSimilarSlides,
  buildSixGridGroups,
  classifySlideAspect,
  inspectSlideAspect,
  portfolioMockupMode,
  scoreSlideAssessment,
  selectPortfolioSlides,
  shortMockupRankedIndexes,
} from "./slide-selection.ts";

test("classifies the four supported page shapes and leaves custom pages unknown", () => {
  assert.equal(classifySlideAspect({ width: 1920, height: 1080 }), "16:9");
  assert.equal(classifySlideAspect({ width: 1600, height: 1200 }), "4:3");
  assert.equal(classifySlideAspect({ width: 297, height: 210 }), "a4_landscape");
  assert.equal(classifySlideAspect({ width: 210, height: 297 }), "a4_portrait");
  assert.equal(classifySlideAspect({ width: 1100, height: 850 }), "unknown");
  assert.equal(classifySlideAspect({ width: 0, height: 0 }), "unknown");
  assert.equal(inspectSlideAspect(16 / 9).confidence, 1);
});

test("uses exact page-count boundaries for mockup mode", () => {
  assert.equal(portfolioMockupMode(4), "insufficient");
  assert.equal(portfolioMockupMode(5), "short");
  assert.equal(portfolioMockupMode(19), "short");
  assert.equal(portfolioMockupMode(20), "long");
});

test("applies the 40/30/20/10 score weights", () => {
  const scored = scoreSlideAssessment({
    slideIndex: 3,
    diagramRichness: 100,
    visualQuality: 80,
    rarity: 50,
    sectionDiversity: 20,
  });
  assert.equal(scored.totalScore, 76);
  assert.deepEqual(scored.components, {
    diagramRichness: 100,
    visualQuality: 80,
    rarity: 50,
    sectionDiversity: 20,
  });
});

test("keeps explicit component scores on the documented 0-100 scale", () => {
  assert.equal(scoreSlideAssessment({
    slideIndex: 0,
    diagramRichness: 5,
    visualQuality: 5,
    rarity: 5,
    sectionDiversity: 5,
  }).totalScore, 5);
  assert.equal(scoreSlideAssessment({
    slideIndex: 1,
    diagramRichness: 10,
    visualQuality: 10,
    rarity: 10,
    sectionDiversity: 10,
  }).totalScore, 10);
});

test("treats null metrics as missing instead of explicit zero", () => {
  const scored = scoreSlideAssessment({
    slideIndex: 1,
    role: "프로세스 도식",
    recommended: true,
    diagramRichness: null,
    visualQuality: null,
    rarity: null,
    sectionDiversity: null,
  });
  assert.ok(scored.components.diagramRichness > 0);
  assert.ok(scored.components.visualQuality > 0);
  assert.ok(scored.components.rarity > 0);
  assert.equal(scored.components.sectionDiversity, 50);
});

test("deduplicates explicit near-similar layouts and keeps the stronger slide", () => {
  const weak = {
    slideIndex: 2,
    similarityKey: "three-column-process",
    diagramRichness: 50,
    visualQuality: 50,
    rarity: 50,
  };
  const strong = {
    slideIndex: 7,
    similarityKey: "three column process",
    diagramRichness: 95,
    visualQuality: 90,
    rarity: 80,
  };
  assert.equal(areNearSimilarSlides(weak, strong), true);

  const result = selectPortfolioSlides({
    slideCount: 8,
    assessments: [weak, strong],
  });
  assert.ok(result.selectedSlideIndexes.includes(7));
  assert.ok(!result.selectedSlideIndexes.includes(2));
  assert.deepEqual(result.excludedDuplicates, [{
    slideIndex: 2,
    keptSlideIndex: 7,
    reason: "유사한 레이아웃 또는 시각 구성이 더 높은 점수의 장표와 중복됩니다.",
  }]);
});

test("deduplicates reordered visual-signature tokens", () => {
  assert.equal(areNearSimilarSlides(
    { slideIndex: 1, visualSignature: "orange process diagram three column icons" },
    { slideIndex: 2, visualSignature: "icons three column orange diagram process" },
  ), true);
});

test("deduplicates perceptually matching image hashes before applying the selection limit", () => {
  const assessments = Array.from({ length: 20 }, (_, slideIndex) => ({
    slideIndex,
    diagramRichness: 90 - slideIndex,
    visualQuality: 90 - slideIndex,
    rarity: 90 - slideIndex,
    visualHash: slideIndex === 1
      ? "0000000000000001"
      : ((BigInt(slideIndex) * BigInt("11400714819323198485"))
        & ((BigInt(1) << BigInt(64)) - BigInt(1))).toString(16).padStart(16, "0"),
  }));
  assessments[0].visualHash = "0000000000000000";
  const result = selectPortfolioSlides({ slideCount: 20, assessments, longLimit: 18 });
  assert.equal(result.selectedSlideIndexes.length, 18);
  assert.ok(result.selectedSlideIndexes.includes(0));
  assert.ok(!result.selectedSlideIndexes.includes(1));
  assert.ok(result.selectedSlideIndexes.includes(18));
});

test("keeps distinct local-image slides even when their generated reasons are identical", () => {
  const assessments = Array.from({ length: 36 }, (_, slideIndex) => ({
    slideIndex,
    diagramRichness: 70,
    visualQuality: 75,
    rarity: 65,
    recommended: true,
    reason: "로컬 이미지 분석에서 도식 밀도·시각 균형·희소성이 우수한 장표입니다.",
    visualHash: ((BigInt(slideIndex + 1) * BigInt("11400714819323198485"))
      & ((BigInt(1) << BigInt(64)) - BigInt(1))).toString(16).padStart(16, "0"),
  }));
  const result = selectPortfolioSlides({ slideCount: 36, assessments });
  assert.equal(result.selectedSlideIndexes.length, 30);
  assert.equal(buildSixGridGroups(result.selectedSlideIndexes).length, 5);
});

test("selects visual standouts, caps short documents, and returns original order", () => {
  const assessments = Array.from({ length: 19 }, (_, slideIndex) => ({
    slideIndex,
    diagramRichness: slideIndex >= 14 ? 100 : 20,
    visualQuality: slideIndex >= 14 ? 90 : 40,
    rarity: slideIndex >= 14 ? 85 : 30,
    sectionDiversity: 50,
  }));
  const result = selectPortfolioSlides({ slideCount: 19, assessments });
  assert.equal(result.mode, "short");
  assert.equal(result.selectedSlideIndexes.length, 5);
  assert.deepEqual(result.selectedSlideIndexes, [...result.selectedSlideIndexes].sort((a, b) => a - b));
  for (const standout of [14, 15, 16, 17, 18]) assert.ok(result.selectedSlideIndexes.includes(standout));
});

test("selects 30 slides in long mode", () => {
  const result = selectPortfolioSlides({
    slideCount: 40,
    assessments: Array.from({ length: 40 }, (_, slideIndex) => ({
      slideIndex,
      diagramRichness: 80,
      visualQuality: 80,
      rarity: 75,
      sectionDiversity: 70,
    })),
  });
  assert.equal(result.mode, "long");
  assert.equal(result.selectedSlideIndexes.length, 30);
});

test("drops the lowest-ranked slide, not the last page, for the 13-slot 4:3 template", () => {
  const selectedSlides = Array.from({ length: 14 }, (_, slideIndex) => ({
    slideIndex,
    totalScore: slideIndex === 13 ? 99 : 80 - slideIndex,
    components: { diagramRichness: 80, visualQuality: 80, rarity: 80, sectionDiversity: 80 },
    reason: "테스트",
    rank: slideIndex === 13 ? 1 : slideIndex + 2,
  }));
  const indexes = shortMockupRankedIndexes({ selectedSlides }, 13);
  assert.ok(indexes.includes(13));
  assert.ok(!indexes.includes(12));
});

test("builds only complete non-repeating six-slide groups for long documents", () => {
  assert.deepEqual(buildSixGridGroups(Array.from({ length: 17 }, (_, index) => index)), []);
  for (const [slideCount, expectedSelected, expectedGroups] of [
    [20, 18, 3],
    [29, 24, 4],
    [30, 30, 5],
  ]) {
    const result = selectPortfolioSlides({
      slideCount,
      assessments: Array.from({ length: slideCount }, (_, slideIndex) => ({
        slideIndex,
        diagramRichness: 85,
        visualQuality: 80,
        rarity: 75,
        sectionDiversity: 70,
      })),
    });
    const groups = buildSixGridGroups(result.selectedSlideIndexes);
    const flattened = groups.flat();
    assert.equal(result.selectedSlideIndexes.length, expectedSelected);
    assert.equal(groups.length, expectedGroups);
    assert.ok(groups.every((group) => group.length === 6));
    assert.equal(new Set(flattened).size, flattened.length);
  }
});

test("legacy assessments and missing assessments use deterministic fallbacks", () => {
  const input = {
    slideCount: 8,
    shortLimit: 5,
    assessments: [
      { slideIndex: 0, role: "표지", quality: 7, recommended: false, reason: "표지" },
      { slideIndex: 4, role: "프로세스", quality: 8, recommended: true, reason: "보기 드문 도식과 균형 잡힌 구성" },
    ],
  };
  const first = selectPortfolioSlides(input);
  const second = selectPortfolioSlides(input);
  assert.deepEqual(first, second);
  assert.ok(first.selectedSlideIndexes.includes(4));
  assert.equal(first.selectedSlideIndexes.length, 5);
});
