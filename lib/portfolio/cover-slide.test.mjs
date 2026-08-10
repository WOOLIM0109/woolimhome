import assert from "node:assert/strict";
import test from "node:test";

import { automaticDesignEligibleSlideIndexes } from "../pc-worker/redaction-manifest.ts";
import { coverSlideBlockedMessage, resolveCoverSlide } from "./cover-slide.ts";

/**
 * 워커는 변환하지 못한 장표를 건너뛰고 남은 것만 0번부터 다시 번호를 매깁니다.
 * skipSourceNumbers 로 그 상황을 그대로 만듭니다.
 */
function manifest({ sourceSlideCount, skipSourceNumbers = [], blockedSourceNumbers = [] }) {
  const skipped = new Set(skipSourceNumbers);
  const blocked = new Set(blockedSourceNumbers);
  const slides = [];
  let slideIndex = 0;
  for (let sourceSlideNumber = 1; sourceSlideNumber <= sourceSlideCount; sourceSlideNumber += 1) {
    if (skipped.has(sourceSlideNumber)) continue;
    slides.push({
      slideIndex,
      sourceSlideNumber,
      inspectionStatus: "verified",
      regions: blocked.has(sourceSlideNumber)
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
    });
    slideIndex += 1;
  }
  return {
    version: 2,
    method: "powerpoint_com_shapes_v2",
    sourceSlideCount,
    slideCount: slides.length,
    slides,
  };
}

function resolve(value) {
  return resolveCoverSlide({
    slides: value.slides,
    eligibleSlideIndexes: automaticDesignEligibleSlideIndexes(value),
  });
}

test("모든 장표가 변환되면 표지는 0번이다", () => {
  const result = resolve(manifest({ sourceSlideCount: 30 }));
  assert.equal(result.coverIndex, 0);
  assert.equal(result.blockedReason, null);
});

test("표지 앞 장표가 빠져도 원본 1장을 정확히 찾는다", () => {
  // 실제로 보고된 현상: 변환에서 빠진 장표가 있으면 번호가 밀려
  // 0번이 표지가 아닌데도 표지로 쓰여 엉뚱한 썸네일이 올라갔습니다.
  const result = resolve(manifest({ sourceSlideCount: 30, skipSourceNumbers: [2, 3] }));
  assert.equal(result.coverIndex, 0);
});

test("표지가 변환에서 빠지면 0번을 표지로 쓰지 않는다", () => {
  const result = resolve(manifest({ sourceSlideCount: 30, skipSourceNumbers: [1] }));
  assert.equal(result.coverIndex, undefined);
  assert.equal(result.blockedReason, "not_converted");
});

test("표지가 가림 검사에서 빠지면 다른 장표로 바꿔치기하지 않는다", () => {
  const result = resolve(manifest({ sourceSlideCount: 30, blockedSourceNumbers: [1] }));
  assert.equal(result.coverIndex, undefined);
  assert.equal(result.blockedReason, "redaction_excluded");
});

test("표지 기록이 없는 예전 작업은 0번을 표지로 본다", () => {
  assert.deepEqual(
    resolveCoverSlide({ slides: null, eligibleSlideIndexes: [0, 1, 2] }),
    { coverIndex: 0, blockedReason: null },
  );
  assert.deepEqual(
    resolveCoverSlide({ slides: [], eligibleSlideIndexes: [1, 2] }),
    { coverIndex: undefined, blockedReason: "redaction_excluded" },
  );
});

test("보류 사유는 원인마다 다른 문장을 쓴다", () => {
  const notConverted = coverSlideBlockedMessage("not_converted");
  const excluded = coverSlideBlockedMessage("redaction_excluded");
  assert.notEqual(notConverted, excluded);
  assert.ok(notConverted.includes("변환"));
  assert.ok(excluded.includes("가림"));
});
