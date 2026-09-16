/**
 * 장표 안의 그림 하나가 어떤 역할인지 봅니다.
 *
 * 예전에는 photo-detect.ts 가 "사진이냐 일러스트냐"만 물었고, 사진이면 가렸습니다.
 * 그런데 실제로 필요한 판단은 "고객을 알아볼 수 있느냐"입니다.
 * 이 둘은 관계가 없고, 로고에서는 아예 반대로 나왔습니다.
 *
 *   · 고객사 로고  → 색이 적고 평평하니 '일러스트' → 살림   (가려야 하는데)
 *   · 딸기 사진    → 색이 많고 연속 톤이니 '사진'   → 가림   (살려야 하는데)
 *
 * 게다가 로고인지는 도형의 '이름'으로 판단했습니다. PowerPoint 에서 그림을
 * 붙여넣으면 이름이 'Picture 5' 로 붙으니 로고라는 글자가 있을 리 없고,
 * 어쩌다 누가 이름을 바꿔 둔 것만 걸렸습니다. 로고가 뜨문뜨문 지워진 이유입니다.
 *
 * 그래서 묻는 것을 바꿉니다. 규칙을 사람 말로 적으면 이렇습니다.
 *
 *   로고와 사람 얼굴만 가린다. 나머지 그림은 남긴다.
 *
 * 로고는 그림 내용이 아니라 '반복'으로 잡습니다. 로고는 여러 장표의 거의 같은
 * 자리에 같은 그림으로 되풀이되지만, 작업물 사진은 그러지 않습니다.
 * 도형 이름에 기대지 않으니 뜨문뜨문 지워지는 일이 없어집니다.
 */

import { perceptualHashDistance } from "./image-fingerprint.ts";

export type ImageRole = "logo" | "person_photo" | "artwork";

export type ImageObservation = {
  /** 장표 번호와 영역 번호를 합친 값. 판정 결과를 되돌려 줄 때 씁니다. */
  key: string;
  slideIndex: number;
  /** 장표 넓이 대비 이 그림이 차지하는 비율 (0~1). */
  areaShare: number;
  /** 장표 가장자리까지의 거리 중 가장 가까운 값 (0~0.5). 작을수록 가장자리. */
  edgeDistance: number;
  /** 같은 그림인지 견주는 지각 해시. */
  visualHash: string;
  /** 살빛으로 보이는 픽셀 비율 (0~1). */
  skinShare: number;
  /** photo-detect 가 평평한 그림(일러스트·로고)으로 본 경우 참. */
  illustrationLike: boolean;
};

/** 로고로 보기에 충분히 작은 크기. 장표 넓이 대비. */
export const LOGO_MAX_AREA_SHARE = 0.05;

/** 로고가 놓이는 자리. 가장자리에서 이 거리 안쪽이어야 합니다. */
export const LOGO_EDGE_MARGIN = 0.14;

/** 이만큼의 서로 다른 장표에 되풀이되면 로고로 봅니다. */
export const LOGO_REPEAT_MIN_SLIDES = 2;

/** 같은 그림으로 볼 지각 해시 거리. 로고는 똑같이 그려지므로 작게 잡습니다. */
export const LOGO_HASH_DISTANCE = 5;

/**
 * 사람이 찍힌 사진으로 볼 살빛 비율.
 *
 * 넉넉히 잡으면 베이지색 배경 사진까지 사람으로 봅니다.
 * 잘못 가리면 작업물이 사라지므로, 살빛이 뚜렷하게 많을 때만 가립니다.
 */
export const PERSON_SKIN_MIN_SHARE = 0.18;

/**
 * 이 픽셀이 살빛인지 봅니다.
 *
 * 밝기는 사람마다 크게 다르지만, 빨강·초록·파랑의 '비율'은 훨씬 덜 흔들립니다.
 * 그래서 밝기를 나눠 없앤 뒤 비율만 봅니다. 이렇게 하면 짙은 살빛도 같이 잡히고,
 * 새빨간 딸기처럼 빨강이 지나치게 치우친 색은 빠집니다.
 */
export function isSkinTone(red: number, green: number, blue: number) {
  const sum = red + green + blue;
  // 너무 어두우면 색비율이 널뛰어서 판단할 수 없습니다.
  if (sum < 90) return false;
  const redShare = red / sum;
  const greenShare = green / sum;
  if (redShare < 0.35 || redShare > 0.48) return false;
  if (greenShare < 0.27 || greenShare > 0.363) return false;
  // 살빛은 언제나 빨강 > 초록 > 파랑 순서입니다.
  return red > green && green > blue;
}

/**
 * 잘라낸 그림에서 살빛 픽셀 비율을 셉니다.
 *
 * @param pixels RGB 세 개씩 이어 붙인 값
 */
export function skinToneShare(pixels: Uint8Array | Buffer) {
  const pixelCount = Math.floor(pixels.length / 3);
  if (pixelCount < 1) return 0;
  let skin = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 3;
    if (isSkinTone(pixels[offset], pixels[offset + 1], pixels[offset + 2])) skin += 1;
  }
  return skin / pixelCount;
}

/** 같은 그림끼리 묶습니다. 로고는 장표마다 똑같이 그려집니다. */
function groupByVisualHash(observations: ImageObservation[]) {
  const groups: ImageObservation[][] = [];
  for (const observation of observations) {
    const group = groups.find((candidate) => (
      perceptualHashDistance(candidate[0].visualHash, observation.visualHash) <= LOGO_HASH_DISTANCE
    ));
    if (group) group.push(observation);
    else groups.push([observation]);
  }
  return groups;
}

/**
 * 모아 둔 그림들의 역할을 한꺼번에 정합니다.
 *
 * 되풀이 여부는 장표 하나만 봐서는 알 수 없어서, 문서 전체를 함께 봅니다.
 */
export function resolveImageRoles(observations: ImageObservation[]) {
  const roles = new Map<string, ImageRole>();

  for (const group of groupByVisualHash(observations)) {
    const slides = new Set(group.map((observation) => observation.slideIndex));
    const allSmall = group.every((observation) => observation.areaShare <= LOGO_MAX_AREA_SHARE);
    // 여러 장표에 되풀이되는 작은 그림. 로고·워터마크가 여기 들어옵니다.
    const repeatedMark = allSmall && slides.size >= LOGO_REPEAT_MIN_SLIDES;
    for (const observation of group) {
      if (repeatedMark) {
        roles.set(observation.key, "logo");
        continue;
      }
      /*
       * 한 장표에만 있는 로고도 있습니다. 표지 아래에 나란히 놓인 참여기관
       * 로고 줄이 그렇습니다. 작고, 가장자리에 붙어 있고, 평평한 그림이면
       * 되풀이되지 않아도 로고로 봅니다. 본문 한가운데의 아이콘은 가장자리
       * 조건에서 빠집니다.
       */
      if (
        observation.areaShare <= LOGO_MAX_AREA_SHARE
        && observation.edgeDistance <= LOGO_EDGE_MARGIN
        && observation.illustrationLike
      ) {
        roles.set(observation.key, "logo");
        continue;
      }
      // 살빛이 뚜렷하게 많은 연속 톤 그림만 사람 사진으로 봅니다.
      if (!observation.illustrationLike && observation.skinShare >= PERSON_SKIN_MIN_SHARE) {
        roles.set(observation.key, "person_photo");
        continue;
      }
      // 딸기·농장·아이콘·일러스트처럼 고객을 가리키지 않는 그림은 남깁니다.
      roles.set(observation.key, "artwork");
    }
  }

  return roles;
}

/** 가려야 하는 역할인지 알려 줍니다. */
export function shouldRedactImageRole(role: ImageRole) {
  return role === "logo" || role === "person_photo";
}

/** 사람이 읽을 가림 사유. 결과 화면에 그대로 보여 줍니다. */
export const IMAGE_ROLE_LABELS: Record<ImageRole, string> = {
  logo: "로고·워터마크",
  person_photo: "사람이 찍힌 사진",
  artwork: "작업물 (가리지 않음)",
};
