import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyImageRegion,
  imageRegionStats,
  photoDetectionEnabled,
} from "./photo-detect.ts";

/** 색을 몇 가지만 쓰고 넓은 면이 고르게 칠해진 그림. 캐릭터·아이콘이 이렇습니다. */
function flatArtwork(size = 64) {
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      const band = y < size / 2 ? [250, 240, 60] : [240, 90, 70];
      const inside = x > size / 4 && x < (size * 3) / 4;
      const color = inside ? band : [255, 255, 255];
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return pixels;
}

/** 색이 잘게 흩어지고 이웃끼리 계속 달라지는 그림. 사진이 이렇습니다. */
function photograph(size = 64) {
  const pixels = Buffer.alloc(size * size * 3);
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 3;
    pixels[offset] = Math.floor(next() * 256);
    pixels[offset + 1] = Math.floor(next() * 256);
    pixels[offset + 2] = Math.floor(next() * 256);
  }
  return pixels;
}

test("캐릭터·일러스트는 그대로 보여 준다", () => {
  const stats = imageRegionStats(flatArtwork(), 64, 0.08);
  assert.equal(classifyImageRegion(stats).kind, "illustration");
});

test("실제 사진은 가린다", () => {
  const stats = imageRegionStats(photograph(), 64, 0.08);
  assert.equal(classifyImageRegion(stats).kind, "photograph");
});

test("아주 작은 그림은 아이콘으로 보고 남긴다", () => {
  const verdict = classifyImageRegion({
    distinctColors: 900,
    modalShare: 0.02,
    flatShare: 0.1,
    areaShare: 0.004,
  });
  assert.equal(verdict.kind, "illustration");
  assert.equal(verdict.reason, "icon_size");
});

test("판단이 애매하면 사진으로 본다", () => {
  // 색은 적은데 면이 고르지 않은 경우처럼 확실하지 않으면 가리는 쪽을 고릅니다.
  assert.equal(classifyImageRegion({
    distinctColors: 80,
    modalShare: 0.3,
    flatShare: 0.2,
    areaShare: 0.2,
  }).kind, "photograph");
  assert.equal(classifyImageRegion({
    distinctColors: 900,
    modalShare: 0.4,
    flatShare: 0.9,
    areaShare: 0.2,
  }).kind, "photograph");
});

test("픽셀이 너무 적으면 판단하지 않는다", () => {
  const stats = imageRegionStats(Buffer.alloc(3), 1, 0.2);
  assert.equal(stats.distinctColors, 0);
});

test("환경변수로 그림 판별을 끌 수 있다", () => {
  const before = process.env.PORTFOLIO_KEEP_ILLUSTRATIONS;
  try {
    delete process.env.PORTFOLIO_KEEP_ILLUSTRATIONS;
    assert.equal(photoDetectionEnabled(), true);
    process.env.PORTFOLIO_KEEP_ILLUSTRATIONS = "false";
    assert.equal(photoDetectionEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.PORTFOLIO_KEEP_ILLUSTRATIONS;
    else process.env.PORTFOLIO_KEEP_ILLUSTRATIONS = before;
  }
});
