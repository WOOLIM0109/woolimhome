import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_ROLE_LABELS,
  LOGO_MAX_AREA_SHARE,
  PERSON_SKIN_MIN_SHARE,
  isSkinTone,
  resolveImageRoles,
  shouldRedactImageRole,
  skinToneShare,
} from "./image-role.ts";

/*
 * 담당자가 실제로 겪은 일은 이렇습니다.
 *
 *   · 고객사 로고를 지우랬더니 뜨문뜨문 지웠다
 *   · 디자인의 일부인 딸기 사진과 일러스트까지 지워 버렸다
 *
 * 예전 판정이 "사진이냐 일러스트냐"를 물었기 때문입니다. 로고는 평평해서
 * 일러스트로 분류돼 살아남고, 딸기 사진은 연속 톤이라 사진으로 분류돼 지워졌습니다.
 * 원하는 것과 정확히 반대였습니다.
 */

function observation(overrides = {}) {
  return {
    key: "0:0",
    slideIndex: 0,
    areaShare: 0.2,
    edgeDistance: 0.3,
    visualHash: "0000000000000000",
    skinShare: 0,
    illustrationLike: false,
    ...overrides,
  };
}

test("여러 장표에 되풀이되는 작은 그림은 로고로 본다", () => {
  // 같은 로고가 1·2·3쪽 같은 자리에 놓인 상황입니다.
  // 도형 이름이 'Picture 5' 여도 상관없이 잡혀야 합니다.
  const roles = resolveImageRoles([
    observation({ key: "0:0", slideIndex: 0, areaShare: 0.01, visualHash: "ff00ff00ff00ff00" }),
    observation({ key: "1:0", slideIndex: 1, areaShare: 0.01, visualHash: "ff00ff00ff00ff00" }),
    observation({ key: "2:0", slideIndex: 2, areaShare: 0.01, visualHash: "ff00ff00ff00ff00" }),
  ]);
  for (const key of ["0:0", "1:0", "2:0"]) {
    assert.equal(roles.get(key), "logo", `${key} 가 로고로 안 잡힙니다.`);
    assert.equal(shouldRedactImageRole(roles.get(key)), true);
  }
});

test("같은 로고는 장표가 달라도 모두 같은 판정을 받는다", () => {
  // '뜨문뜨문 지워지던' 증상이 여기서 걸립니다.
  const roles = resolveImageRoles([
    observation({ key: "0:0", slideIndex: 0, areaShare: 0.008, visualHash: "0f0f0f0f0f0f0f0f" }),
    // 지각 해시가 1비트 다른, 사실상 같은 그림
    observation({ key: "5:2", slideIndex: 5, areaShare: 0.008, visualHash: "0f0f0f0f0f0f0f0e" }),
  ]);
  assert.equal(roles.get("0:0"), "logo");
  assert.equal(roles.get("5:2"), "logo");
});

test("표지 아래 한 줄로 놓인 참여기관 로고도 잡는다", () => {
  // 표지에만 한 번 나오므로 되풀이로는 못 잡습니다.
  // 작고, 가장자리에 붙어 있고, 평평한 그림이면 로고로 봅니다.
  const roles = resolveImageRoles([
    observation({
      key: "0:3",
      areaShare: 0.006,
      edgeDistance: 0.04,
      illustrationLike: true,
      visualHash: "1234567812345678",
    }),
  ]);
  assert.equal(roles.get("0:3"), "logo");
});

test("본문 한가운데의 아이콘은 로고로 보지 않는다", () => {
  // 작고 평평하지만 가장자리가 아니므로 작업물입니다.
  const roles = resolveImageRoles([
    observation({
      key: "3:1",
      areaShare: 0.004,
      edgeDistance: 0.42,
      illustrationLike: true,
      visualHash: "aaaaaaaaaaaaaaaa",
    }),
  ]);
  assert.equal(roles.get("3:1"), "artwork");
  assert.equal(shouldRedactImageRole(roles.get("3:1")), false);
});

test("딸기 사진과 일러스트는 남긴다", () => {
  const roles = resolveImageRoles([
    // 딸기 사진: 연속 톤이지만 살빛이 아님
    observation({ key: "1:1", areaShare: 0.3, skinShare: 0.02, visualHash: "1111111111111111" }),
    // 일러스트: 평평하고 크다
    observation({
      key: "2:1",
      areaShare: 0.35,
      illustrationLike: true,
      visualHash: "2222222222222222",
    }),
  ]);
  assert.equal(roles.get("1:1"), "artwork");
  assert.equal(roles.get("2:1"), "artwork");
});

test("사람이 찍힌 사진은 가린다", () => {
  const roles = resolveImageRoles([
    observation({
      key: "4:0",
      areaShare: 0.25,
      skinShare: PERSON_SKIN_MIN_SHARE + 0.05,
      illustrationLike: false,
      visualHash: "3333333333333333",
    }),
  ]);
  assert.equal(roles.get("4:0"), "person_photo");
  assert.equal(shouldRedactImageRole(roles.get("4:0")), true);
});

test("큰 그림은 여러 장에 되풀이돼도 로고로 보지 않는다", () => {
  // 같은 배경 사진을 여러 장에 쓴 경우입니다. 로고가 아니라 디자인입니다.
  const big = { areaShare: LOGO_MAX_AREA_SHARE + 0.3, visualHash: "4444444444444444" };
  const roles = resolveImageRoles([
    observation({ key: "0:0", slideIndex: 0, ...big }),
    observation({ key: "1:0", slideIndex: 1, ...big }),
    observation({ key: "2:0", slideIndex: 2, ...big }),
  ]);
  assert.equal(roles.get("0:0"), "artwork");
});

test("살빛은 밝기가 달라도 잡고, 새빨간 색은 빼야 한다", () => {
  assert.equal(isSkinTone(224, 172, 140), true, "밝은 살빛을 놓칩니다.");
  assert.equal(isSkinTone(150, 110, 85), true, "중간 살빛을 놓칩니다.");
  assert.equal(isSkinTone(105, 75, 58), true, "짙은 살빛을 놓칩니다.");

  assert.equal(isSkinTone(200, 30, 40), false, "딸기 빨강을 살빛으로 봅니다.");
  assert.equal(isSkinTone(60, 130, 55), false, "잎사귀 초록을 살빛으로 봅니다.");
  assert.equal(isSkinTone(40, 90, 200), false, "파랑을 살빛으로 봅니다.");
  assert.equal(isSkinTone(250, 250, 250), false, "흰 배경을 살빛으로 봅니다.");
  assert.equal(isSkinTone(12, 9, 7), false, "거의 검은 색을 살빛으로 봅니다.");
});

test("살빛 비율을 픽셀에서 센다", () => {
  // 네 픽셀 중 하나만 살빛
  const pixels = Buffer.from([
    224, 172, 140,
    200, 30, 40,
    60, 130, 55,
    255, 255, 255,
  ]);
  assert.equal(skinToneShare(pixels), 0.25);
  assert.equal(skinToneShare(Buffer.alloc(0)), 0);
});

test("가림 사유에 사람이 읽을 이름이 붙어 있다", () => {
  assert.equal(IMAGE_ROLE_LABELS.logo, "로고·워터마크");
  assert.equal(IMAGE_ROLE_LABELS.person_photo, "사람이 찍힌 사진");
  assert.equal(shouldRedactImageRole("artwork"), false);
});
