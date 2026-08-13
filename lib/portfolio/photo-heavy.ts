/**
 * 사진으로 뒤덮인 장표 골라내기
 *
 * 실제 사진은 가림 대상입니다. 그런데 장표 전체가 사진으로 채워져 있으면
 * 가리고 난 뒤에 남는 것이 없어, 포트폴리오에 실어도 보여 줄 것이 없습니다.
 * 실제로 행사 사진이 줄지어 붙은 장표들이 통째로 흐려진 채 올라갔습니다.
 *
 * 표도 같은 이유로 뺍니다. 표 하나로 꽉 찬 장표는 가림과 무관하게
 * 디자인을 보여 주는 자리가 아니라 자료 목록에 가깝습니다.
 *
 * 그래서 사진이 넓게 깔린 장표와 표로 꽉 찬 장표를 목업 선정에서 뺍니다.
 * 다만 캐릭터나 아이콘 한두 개가 들어간 장표까지 빼면 안 됩니다.
 * 그런 장표야말로 디자인을 보여 주는 자리이기 때문입니다.
 *
 * 그래서 두 조건을 모두 만족할 때만 뺍니다.
 *   · 그림이 장표의 넓은 면적을 차지하고
 *   · 그림 조각이 여러 개 흩어져 있을 때 (사진을 늘어놓은 배치)
 *
 * 뺄 장표가 너무 많아 목업을 만들 수 없게 되면, 사진이 적은 순서대로 되살립니다.
 */

type PhotoRegion = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PhotoSlide = {
  slideIndex: number;
  regions: PhotoRegion[];
};

/** 이 비율보다 넓게 그림이 깔리면 사진 위주 장표로 봅니다. */
export const PHOTO_HEAVY_MIN_COVERAGE = 0.3;
/** 이 개수 이상 흩어져 있어야 '사진을 늘어놓은 장표'로 봅니다. */
export const PHOTO_HEAVY_MIN_REGIONS = 3;
/**
 * 사진 한 장이 이 비율을 넘게 덮으면 조각 수와 관계없이 뺍니다.
 *
 * 조각 세 개 규칙만 두었더니 큰 사진 한두 장으로 꽉 찬 장표가 그대로 남아,
 * 가리고 나면 화면 절반이 뿌연 목업이 올라갔습니다.
 * 캐릭터나 아이콘은 이만큼 넓게 깔리지 않으므로 이 기준에 걸리지 않습니다.
 */
export const PHOTO_DOMINANT_MIN_COVERAGE = 0.45;

function envNumber(name: string, fallback: number, max = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}

/** 표가 장표에서 차지하는 넓이가 이 비율을 넘으면 표 위주 장표로 봅니다. */
export const TABLE_HEAVY_MIN_COVERAGE = 0.45;

/** 지정한 종류의 영역이 장표에서 차지하는 넓이. 겹치는 부분은 한 번만 셉니다. */
export function regionCoverage(regions: PhotoRegion[], types: string[]) {
  const photos = regions.filter((region) => types.includes(region.type));
  if (!photos.length) return 0;
  const columns = [...new Set(photos.flatMap((region) => [region.x, region.x + region.width]))]
    .sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index + 1 < columns.length; index += 1) {
    const left = columns[index];
    const right = columns[index + 1];
    const width = right - left;
    if (width <= 0) continue;
    const spans = photos
      .filter((region) => region.x < right && region.x + region.width > left)
      .map((region) => [region.y, region.y + region.height] as const)
      .sort((first, second) => first[0] - second[0]);
    let covered = 0;
    let start: number | null = null;
    let end = 0;
    for (const [spanStart, spanEnd] of spans) {
      if (start === null) {
        start = spanStart;
        end = spanEnd;
      } else if (spanStart <= end) {
        end = Math.max(end, spanEnd);
      } else {
        covered += end - start;
        start = spanStart;
        end = spanEnd;
      }
    }
    if (start !== null) covered += end - start;
    area += width * covered;
  }
  return Math.max(0, Math.min(1, area));
}

/** 그림이 차지하는 넓이 */
export function photoCoverage(regions: PhotoRegion[]) {
  return regionCoverage(regions, ["embedded_photo"]);
}

/** 표가 차지하는 넓이 */
export function tableCoverage(regions: PhotoRegion[]) {
  return regionCoverage(regions, ["table_content"]);
}

/**
 * 표로 뒤덮인 장표인지 봅니다.
 *
 * 표는 가림 대상이 아니라 그대로 보입니다. 다만 장표가 표 하나로 꽉 차 있으면
 * 디자인을 보여 주는 자리가 아니라 자료 목록에 가까워, 포트폴리오에서는 뺍니다.
 */
export function isTableHeavySlide(slide: PhotoSlide) {
  return tableCoverage(slide.regions)
    >= envNumber("PORTFOLIO_TABLE_HEAVY_MIN_COVERAGE", TABLE_HEAVY_MIN_COVERAGE);
}

export function isPhotoHeavySlide(slide: PhotoSlide) {
  const photos = slide.regions.filter((region) => region.type === "embedded_photo");
  if (!photos.length) return false;
  const coverage = photoCoverage(slide.regions);
  // 큰 사진 한 장으로 꽉 찬 장표도 뺍니다. 조각 수를 따지지 않습니다.
  if (coverage >= envNumber("PORTFOLIO_PHOTO_DOMINANT_MIN_COVERAGE", PHOTO_DOMINANT_MIN_COVERAGE)) {
    return true;
  }
  if (photos.length < envNumber("PORTFOLIO_PHOTO_HEAVY_MIN_REGIONS", PHOTO_HEAVY_MIN_REGIONS, 50)) {
    return false;
  }
  return coverage >= envNumber("PORTFOLIO_PHOTO_HEAVY_MIN_COVERAGE", PHOTO_HEAVY_MIN_COVERAGE);
}

/**
 * 보여 줄 것이 적은 장표를 뺀 목록을 돌려줍니다.
 *
 * 사진으로 뒤덮인 장표와 표 하나로 꽉 찬 장표가 대상입니다.
 *
 * @param minimumKept 남겨야 할 최소 장표 수. 이보다 적어지면 덜 심한 것부터 되살립니다.
 */
export function excludePhotoHeavySlides(input: {
  slides: PhotoSlide[];
  eligibleSlideIndexes: number[];
  minimumKept: number;
}) {
  const eligible = new Set(input.eligibleSlideIndexes);
  const scored = input.slides
    .filter((slide) => eligible.has(slide.slideIndex))
    .map((slide) => ({
      slideIndex: slide.slideIndex,
      coverage: Math.max(photoCoverage(slide.regions), tableCoverage(slide.regions)),
      unusable: isPhotoHeavySlide(slide) || isTableHeavySlide(slide),
    }));
  const kept = scored.filter((slide) => !slide.unusable);
  const removed = scored.filter((slide) => slide.unusable);

  // 너무 많이 빠져 목업을 못 만들 상황이면 사진이 적은 것부터 되살립니다.
  const restored = [...removed].sort((left, right) => left.coverage - right.coverage);
  while (kept.length < input.minimumKept && restored.length) {
    kept.push(restored.shift()!);
  }
  return {
    keptSlideIndexes: kept.map((slide) => slide.slideIndex).sort((left, right) => left - right),
    excludedSlideIndexes: restored.map((slide) => slide.slideIndex).sort((left, right) => left - right),
  };
}
