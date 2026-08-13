import assert from "node:assert/strict";
import test from "node:test";

import {
  excludePhotoHeavySlides,
  isPhotoHeavySlide,
  isTableHeavySlide,
  photoCoverage,
  tableCoverage,
} from "./photo-heavy.ts";

function region(type, x, y, width, height) {
  return { type, x, y, width, height };
}

/** 행사 사진을 여섯 장 늘어놓은 장표. 가리고 나면 남는 것이 없습니다. */
const 사진장표 = {
  slideIndex: 0,
  regions: [
    region("embedded_photo", 0.05, 0.1, 0.28, 0.35),
    region("embedded_photo", 0.36, 0.1, 0.28, 0.35),
    region("embedded_photo", 0.67, 0.1, 0.28, 0.35),
    region("embedded_photo", 0.05, 0.5, 0.28, 0.35),
    region("embedded_photo", 0.36, 0.5, 0.28, 0.35),
    region("embedded_photo", 0.67, 0.5, 0.28, 0.35),
  ],
};

/** 캐릭터 한 장이 들어간 장표. 디자인을 보여 주는 자리라 남겨야 합니다. */
const 캐릭터장표 = {
  slideIndex: 1,
  regions: [
    region("embedded_photo", 0.6, 0.55, 0.3, 0.35),
    region("small_text", 0.05, 0.9, 0.3, 0.02),
  ],
};

/** 장표 전체가 표 하나인 경우. 자료 목록에 가깝습니다. */
const 표장표 = {
  slideIndex: 2,
  regions: [region("table_content", 0.05, 0.15, 0.9, 0.75)],
};

/** 작은 표와 도식이 함께 있는 장표. 남겨야 합니다. */
const 도식장표 = {
  slideIndex: 3,
  regions: [
    region("table_content", 0.05, 0.6, 0.4, 0.25),
    region("chart_label", 0.55, 0.2, 0.4, 0.3),
  ],
};

test("사진을 늘어놓은 장표는 뺀다", () => {
  assert.ok(photoCoverage(사진장표.regions) > 0.5);
  assert.equal(isPhotoHeavySlide(사진장표), true);
});

test("캐릭터 한 장 들어간 장표는 남긴다", () => {
  // 그림 조각이 하나뿐이라 '사진을 늘어놓은 배치'가 아닙니다.
  assert.equal(isPhotoHeavySlide(캐릭터장표), false);
});

test("장표 전체가 표면 뺀다", () => {
  assert.ok(tableCoverage(표장표.regions) > 0.6);
  assert.equal(isTableHeavySlide(표장표), true);
});

test("작은 표와 도식이 섞인 장표는 남긴다", () => {
  assert.equal(isTableHeavySlide(도식장표), false);
  assert.equal(isPhotoHeavySlide(도식장표), false);
});

test("뺀 장표와 남긴 장표를 나눠 돌려준다", () => {
  const result = excludePhotoHeavySlides({
    slides: [사진장표, 캐릭터장표, 표장표, 도식장표],
    eligibleSlideIndexes: [0, 1, 2, 3],
    minimumKept: 2,
  });
  assert.deepEqual(result.keptSlideIndexes, [1, 3]);
  assert.deepEqual(result.excludedSlideIndexes, [0, 2]);
});

test("최소 장수를 못 채우면 덜 심한 것부터 되살린다", () => {
  // 목업을 아예 못 만들게 되는 상황을 막습니다.
  const result = excludePhotoHeavySlides({
    slides: [사진장표, 캐릭터장표, 표장표, 도식장표],
    eligibleSlideIndexes: [0, 1, 2, 3],
    minimumKept: 4,
  });
  assert.deepEqual(result.keptSlideIndexes, [0, 1, 2, 3]);
  assert.deepEqual(result.excludedSlideIndexes, []);
});

test("가림 검사에서 이미 빠진 장표는 계산에 넣지 않는다", () => {
  const result = excludePhotoHeavySlides({
    slides: [사진장표, 캐릭터장표, 표장표, 도식장표],
    eligibleSlideIndexes: [1, 3],
    minimumKept: 1,
  });
  assert.deepEqual(result.keptSlideIndexes, [1, 3]);
  assert.deepEqual(result.excludedSlideIndexes, []);
});
