import assert from "node:assert/strict";
import test from "node:test";

import { automaticDesignEligibleSlideIndexes } from "../pc-worker/redaction-manifest.ts";
import { PORTFOLIO_COVER_SLIDE_INDEX, resolveCoverIndex } from "./cover-slide.ts";

function manifest(slideCount, blockedIndexes = []) {
  const blocked = new Set(blockedIndexes);
  return {
    version: 2,
    method: "powerpoint_com_shapes_v2",
    sourceSlideCount: slideCount,
    slideCount,
    slides: Array.from({ length: slideCount }, (_, slideIndex) => ({
      slideIndex,
      sourceSlideNumber: slideIndex + 1,
      inspectionStatus: "verified",
      // 가림이 장표를 거의 다 덮으면 자동 디자인에서 제외됩니다.
      regions: blocked.has(slideIndex)
        ? [{
          slideIndex,
          type: "client_identifier",
          label: "local_identifier",
          x: 0,
          y: 0,
          width: 0.99,
          height: 0.99,
        }]
        : [],
    })),
  };
}

test("대표 썸네일은 언제나 원본 표지 1장이다", () => {
  assert.equal(PORTFOLIO_COVER_SLIDE_INDEX, 0);
  const eligible = automaticDesignEligibleSlideIndexes(manifest(30));
  assert.equal(resolveCoverIndex(eligible), 0);
});

test("표지가 가림 검사에서 빠지면 다른 장표로 바꿔치기하지 않는다", () => {
  // 실제로 보고된 현상: 표지가 제외되자 아무 장표나 썸네일로 올라가
  // 어느 문서의 사례인지 알아볼 수 없었습니다.
  const eligible = automaticDesignEligibleSlideIndexes(manifest(30, [0]));
  assert.ok(!eligible.includes(0));
  assert.equal(resolveCoverIndex(eligible), undefined);
});

test("표지만 살아 있어도 표지를 쓴다", () => {
  assert.equal(resolveCoverIndex([0]), 0);
});

test("쓸 수 있는 장표가 하나도 없으면 표지도 없다", () => {
  assert.equal(resolveCoverIndex([]), undefined);
});

test("Set 으로 받아도 같은 답을 낸다", () => {
  assert.equal(resolveCoverIndex(new Set([0, 3, 7])), 0);
  assert.equal(resolveCoverIndex(new Set([3, 7])), undefined);
});
