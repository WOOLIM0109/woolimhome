import assert from "node:assert/strict";
import test from "node:test";

import { portfolioMockupIndexes } from "./mockup.ts";

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
      // 가림이 장표를 거의 덮으면 자동 디자인에서 제외됩니다.
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

test("표지를 쓸 수 있으면 대표 썸네일은 언제나 1장이다", () => {
  const plan = portfolioMockupIndexes(30, undefined, manifest(30));
  assert.equal(plan.coverIndex, 0);
  assert.equal(plan.indexes[0], 0);
});

test("표지가 제외되면 다른 장표로 바꿔치기하지 않는다", () => {
  // 실제로 보고된 현상: 표지가 가림 검사에서 빠지자
  // 아무 장표나 썸네일로 올라가 어느 문서인지 알 수 없었습니다.
  const plan = portfolioMockupIndexes(30, undefined, manifest(30, [0]));
  assert.equal(plan.coverIndex, undefined);
  assert.ok(plan.blockedSlideIndexes.includes(0));
});

test("표지가 제외돼도 나머지 장표 선정은 그대로 진행된다", () => {
  const plan = portfolioMockupIndexes(30, undefined, manifest(30, [0]));
  assert.ok(plan.selectedIndexes.length > 0);
  assert.ok(!plan.selectedIndexes.includes(0));
});
