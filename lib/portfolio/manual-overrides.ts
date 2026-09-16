/**
 * 손으로 확정한 목업을 쓰는 작업들.
 *
 * 자동 변환이 원본 글꼴을 살리지 못해, 사람이 직접 만든 이미지를 대신 쓰는
 * 건들이 있습니다. 그 예외를 여기 모읍니다.
 *
 * 예전에는 같은 작업 번호와 같은 이미지 목록이 목록 API 와 상세 API 두
 * 파일에 그대로 복사되어 있었습니다. 한쪽만 고치면 두 화면의 답이 갈리고,
 * 다음 고객사가 생기면 세 번째 사본이 생깁니다.
 *
 * lib/portfolio/hyundai-manual-mockups.ts 도 같은 성격입니다. 손볼 일이
 * 생기면 이 파일로 함께 옮기는 것이 좋습니다.
 *
 * 언젠가는 이런 예외를 코드가 아니라 작업의 metadata 로 옮겨야 합니다.
 * 지금은 건수가 적어 코드에 두지만, 늘어나면 그때는 데이터로 가야 합니다.
 */

export const TOURISM_MARKETING_WORK_ITEM_ID = "6579c77c-86fd-4b6a-9e65-654394597c8f";

export const TOURISM_MARKETING_MANUAL_ASSETS = [
  { name: "short-main.jpg", slideIndexes: [2, 4, 5, 9, 10], width: 1600, height: 1600 },
  { name: "short-detail-1.jpg", slideIndexes: [0, 1, 3], width: 1600, height: 900 },
  { name: "short-detail-2.jpg", slideIndexes: [6, 7, 8], width: 1600, height: 900 },
  { name: "short-detail-3.jpg", slideIndexes: [11, 12, 13], width: 1600, height: 900 },
] as const;

export type ManualBodyAsset = {
  kind: "body_image";
  name: string;
  url: string;
  caption: string;
  slideIndexes: number[];
  slideAspectRatio: number;
  width: number;
  height: number;
  mockupMode: "short_psd";
  aspectClass: "16:9";
};

export function isTourismMarketingWorkItem(id: unknown) {
  return id === TOURISM_MARKETING_WORK_ITEM_ID;
}

export function tourismManualAssetUrl(origin: string, name: string) {
  return `${origin}/portfolio/manual/tourism-marketing/${name}`;
}

export function tourismManualAssetUrls(origin: string) {
  return TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => tourismManualAssetUrl(origin, asset.name));
}

export const TOURISM_MANUAL_ASSET_NAMES = TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => asset.name);

export const TOURISM_MANUAL_SELECTED_SLIDE_INDEXES = TOURISM_MARKETING_MANUAL_ASSETS
  .flatMap((asset) => [...asset.slideIndexes]);

/**
 * 본문에 들어갈 이미지 목록.
 *
 * 설명 문구는 화면마다 달라서 부르는 쪽이 정합니다. 문구를 하나로 합치면
 * 지금 두 화면에 나오는 글이 바뀌므로 그대로 둡니다.
 */
export function tourismManualBodyAssets(origin: string, caption: string): ManualBodyAsset[] {
  return TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => ({
    kind: "body_image",
    name: asset.name,
    url: tourismManualAssetUrl(origin, asset.name),
    caption,
    slideIndexes: [...asset.slideIndexes],
    slideAspectRatio: 16 / 9,
    width: asset.width,
    height: asset.height,
    mockupMode: "short_psd",
    aspectClass: "16:9",
  }));
}

/** 목업 설정에 덧씌우는 값. 두 화면이 같은 값을 써야 합니다. */
export function tourismManualMockupFields(previous: unknown) {
  return {
    ...(previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Record<string, unknown>
      : {}),
    mode: "short_psd",
    bodyBoardCount: 4,
    aspectClass: "16:9",
    selectedSlideIndexes: TOURISM_MANUAL_SELECTED_SLIDE_INDEXES,
    manualFontPreservingOverride: true,
  };
}

/** 자동으로 만든 본문 이미지를 걷어냅니다. 손으로 넣은 것으로 갈아 끼우기 전 단계입니다. */
export function withoutGeneratedBodyImages(assets: unknown) {
  return Array.isArray(assets)
    ? assets.filter((asset) => (
      asset && typeof asset === "object" && (asset as Record<string, unknown>).kind !== "body_image"
    ))
    : [];
}
