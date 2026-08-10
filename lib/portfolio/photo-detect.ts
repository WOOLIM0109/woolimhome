/**
 * 그림이 '실제 사진'인지 '캐릭터·아이콘·일러스트'인지 가려냅니다.
 *
 * 포트폴리오에서 캐릭터와 아이콘은 디자인 실력을 보여 주는 핵심입니다.
 * 반면 실제 사진에는 사람 얼굴이나 현장이 그대로 담깁니다.
 * PowerPoint는 둘 다 그냥 '그림'이라고만 알려 주므로, 픽셀을 직접 봅니다.
 *
 * 일러스트는 색 수가 적고 넓은 면이 한 가지 색으로 채워집니다.
 * 사진은 색이 수백 가지로 흩어지고 한 가지 색이 차지하는 비율이 낮습니다.
 *
 * 애매하면 사진으로 봅니다. 잘못 판단했을 때 손해가 큰 쪽을 기본값으로 둡니다.
 */

export type ImageRegionStats = {
  /** 색을 채널당 4비트로 뭉갠 뒤 센 가짓수 */
  distinctColors: number;
  /** 가장 많이 쓰인 색이 차지하는 비율 (0~1) */
  modalShare: number;
  /** 위아래·좌우로 색이 거의 안 바뀌는 픽셀 비율 (0~1) */
  flatShare: number;
  /** 장표 넓이 대비 이 그림이 차지하는 비율 (0~1) */
  areaShare: number;
};

export type ImageRegionVerdict = {
  kind: "illustration" | "photograph";
  reason: string;
};

/** 이 크기보다 작은 그림은 아이콘으로 보고 가리지 않습니다. */
export const ICON_MAX_AREA_SHARE = 0.01;

export const ILLUSTRATION_MAX_DISTINCT_COLORS = 160;
export const ILLUSTRATION_MIN_FLAT_SHARE = 0.55;
export const ILLUSTRATION_MIN_MODAL_SHARE = 0.18;

export function classifyImageRegion(stats: ImageRegionStats): ImageRegionVerdict {
  if (stats.areaShare > 0 && stats.areaShare <= ICON_MAX_AREA_SHARE) {
    return { kind: "illustration", reason: "icon_size" };
  }
  // 색 수가 적으면서 넓은 면이 고르게 칠해져 있으면 일러스트로 봅니다.
  const fewColors = stats.distinctColors <= ILLUSTRATION_MAX_DISTINCT_COLORS;
  const flatEnough = stats.flatShare >= ILLUSTRATION_MIN_FLAT_SHARE;
  const hasDominantColor = stats.modalShare >= ILLUSTRATION_MIN_MODAL_SHARE;
  if (fewColors && flatEnough && hasDominantColor) {
    return { kind: "illustration", reason: "flat_artwork" };
  }
  return { kind: "photograph", reason: "continuous_tone" };
}

/**
 * 픽셀에서 판단에 쓸 값을 뽑습니다.
 *
 * @param pixels RGB 세 개씩 이어 붙인 값
 * @param width  가로 픽셀 수
 */
export function imageRegionStats(
  pixels: Uint8Array | Buffer,
  width: number,
  areaShare: number,
): ImageRegionStats {
  const pixelCount = Math.floor(pixels.length / 3);
  if (pixelCount < 4 || width < 2) {
    return { distinctColors: 0, modalShare: 1, flatShare: 1, areaShare };
  }
  const height = Math.floor(pixelCount / width);
  const buckets = new Map<number, number>();
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 3;
    const key = ((pixels[offset] >> 4) << 8) | ((pixels[offset + 1] >> 4) << 4) | (pixels[offset + 2] >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let modal = 0;
  for (const count of buckets.values()) if (count > modal) modal = count;

  // 오른쪽·아래 이웃과 색이 거의 같은 픽셀을 셉니다.
  let flat = 0;
  let compared = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const offset = (y * width + x) * 3;
      const right = offset + 3;
      const below = ((y + 1) * width + x) * 3;
      const differenceRight = Math.abs(pixels[offset] - pixels[right])
        + Math.abs(pixels[offset + 1] - pixels[right + 1])
        + Math.abs(pixels[offset + 2] - pixels[right + 2]);
      const differenceBelow = Math.abs(pixels[offset] - pixels[below])
        + Math.abs(pixels[offset + 1] - pixels[below + 1])
        + Math.abs(pixels[offset + 2] - pixels[below + 2]);
      compared += 1;
      if (differenceRight <= 12 && differenceBelow <= 12) flat += 1;
    }
  }
  return {
    distinctColors: buckets.size,
    modalShare: modal / pixelCount,
    flatShare: compared ? flat / compared : 1,
    areaShare,
  };
}

/** 그림 판별을 쓸지 여부. 끄면 예전처럼 그림을 모두 가립니다. */
export function photoDetectionEnabled() {
  return process.env.PORTFOLIO_KEEP_ILLUSTRATIONS !== "false";
}
