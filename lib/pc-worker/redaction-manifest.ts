export const LOCAL_REDACTION_MANIFEST_VERSION = 2 as const;
export const LOCAL_REDACTION_MANIFEST_METHOD = "powerpoint_com_shapes_v2" as const;
export const MAX_AUTOMATIC_REDACTION_REGION_COVERAGE = 0.55;
export const MAX_AUTOMATIC_REDACTION_UNION_COVERAGE = 0.65;
export const MAX_AUTOMATIC_REDACTION_TOTAL_COVERAGE = 0.9;

const REGION_LABELS = {
  body_text: new Set(["local_body_text"]),
  small_text: new Set(["local_small_text"]),
  table_content: new Set(["local_table"]),
  chart_label: new Set(["local_chart"]),
  embedded_photo: new Set([
    "local_picture",
    "local_linked_picture",
    "local_media",
    "local_web_media",
    "local_picture_fill",
  ]),
  screenshot: new Set([
    "local_embedded_object",
    "local_linked_object",
    "local_control",
    "local_canvas",
    "local_diagram",
    "local_ink",
    "local_ink_comment",
    "local_smartart",
    "local_slicer",
    "local_ambiguous",
  ]),
  logo: new Set(["local_logo"]),
  footer: new Set(["local_footer"]),
  client_identifier: new Set(["local_identifier"]),
  project_identifier: new Set(["local_project_identifier"]),
} as const;

export type LocalRedactionRegionType = keyof typeof REGION_LABELS;

/**
 * 실제로 가릴 영역 종류.
 *
 * 담당자가 정한 정책입니다.
 *   · 고객사 상호명과 프로젝트명
 *   · 개인정보 (이름·연락처·주소·사업자등록번호는 워커가 식별자로 분류합니다)
 *   · 아주 작은 글씨 (각주와 출처 표기)
 *   · 로고와 바닥글
 *   · 실제 사진 (캐릭터·아이콘·일러스트는 lib/portfolio/photo-detect 가 골라 남깁니다)
 *
 * 남기는 것: 본문 문장, 소제목, 표 내용, 차트 라벨, 다이어그램, 화면 캡처,
 * 그리고 사진처럼 보이지 않는 그림.
 *
 * 환경변수 PORTFOLIO_REDACTED_REGION_TYPES 로 언제든 조정할 수 있습니다.
 * 예전처럼 전부 가리려면 아래 값을 넣으면 됩니다.
 *   body_text,small_text,table_content,chart_label,embedded_photo,screenshot,logo,footer,client_identifier,project_identifier
 */
export const DEFAULT_REDACTED_REGION_TYPES: LocalRedactionRegionType[] = [
  "client_identifier",
  "project_identifier",
  "small_text",
  "logo",
  "footer",
  "embedded_photo",
];

/** 이전 이름. 외부에서 참조하던 곳을 위해 남겨 둡니다. */
export const RECOMMENDED_REDACTED_REGION_TYPES = DEFAULT_REDACTED_REGION_TYPES;

/**
 * '작은 글씨'로 볼 최대 높이 (장표 높이 대비 비율).
 *
 * 워커는 오랫동안 18pt 미만을 전부 작은 글씨로 분류했습니다.
 * 한국어 제안서 본문은 대부분 11~16pt라, 본문 전체가 작은 글씨로 잡혔습니다.
 * 장표 하나에서 가림 영역이 수십 개씩 나오던 이유가 이것입니다.
 *
 * 워커는 이제 11pt를 기준으로 삼지만, 이미 만들어 둔 기록에는
 * 옛 기준으로 붙은 이름이 그대로 남아 있습니다.
 * 그래서 높이로 한 번 더 걸러, 다시 변환하지 않아도 같은 결과가 나오게 합니다.
 *
 * 11pt 한 줄은 장표 높이의 약 2.4%입니다. 여유를 둬 2.8%로 잡았습니다.
 * 환경변수 PORTFOLIO_SMALL_TEXT_MAX_HEIGHT 로 조정할 수 있습니다.
 */
export const DEFAULT_SMALL_TEXT_MAX_HEIGHT = 0.028;

/**
 * 그 장표의 본문 대비 이 비율보다 작아야 '작은 글씨'로 봅니다.
 *
 * 높이 기준만으로는 빽빽한 문서를 감당하지 못했습니다.
 * A4 가로에 9~10pt로 짜인 연구개발 제안서는 본문 전체가 기준 아래로 내려가,
 * 장표 하나에서 가림 영역이 60개씩 잡히고 제목만 남은 채 전부 뿌옇게 나왔습니다.
 *
 * 그래서 절대 크기 대신 그 장표의 글씨 크기와 견줍니다.
 * 본문과 비슷한 크기면 본문으로 보고, 본문보다 뚜렷하게 작을 때만 잔글씨로 봅니다.
 * 이름·연락처처럼 내용으로 잡아내는 영역은 크기와 무관하게 그대로 가립니다.
 *
 * 값이 클수록 잔글씨로 보는 범위가 넓어집니다.
 * 환경변수 PORTFOLIO_SMALL_TEXT_RELATIVE_RATIO 로 조정할 수 있습니다.
 * 2 이상을 넣으면 상대 비교가 꺼져 예전처럼 높이 기준만 씁니다.
 */
export const DEFAULT_SMALL_TEXT_RELATIVE_RATIO = 0.85;

export function smallTextRelativeRatio() {
  const raw = Number(process.env.PORTFOLIO_SMALL_TEXT_RELATIVE_RATIO);
  if (Number.isFinite(raw) && raw > 0 && raw <= 4) return raw;
  return DEFAULT_SMALL_TEXT_RELATIVE_RATIO;
}

const TEXT_REGION_TYPES = new Set<string>(["small_text", "body_text"]);

/**
 * 견줄 글씨가 이만큼은 있어야 상대 비교를 씁니다.
 *
 * 글줄이 한둘뿐인 장표에서 중앙값을 내면 그 잔글씨 자신이 기준이 되어
 * 각주가 본문으로 둔갑합니다. 그런 장표는 예전처럼 높이 기준만 씁니다.
 */
export const SMALL_TEXT_RELATIVE_MIN_SAMPLES = 3;

/** 그 장표의 대표 글씨 높이(중앙값). 견줄 것이 없으면 0 입니다. */
export function slideTextReferenceHeight(
  regions: { type: LocalRedactionRegionType; height?: number }[],
) {
  const heights = regions
    .filter((region) => TEXT_REGION_TYPES.has(region.type))
    .map((region) => region.height)
    .filter((height): height is number => typeof height === "number" && height > 0)
    .sort((left, right) => left - right);
  if (heights.length < SMALL_TEXT_RELATIVE_MIN_SAMPLES) return 0;
  const middle = Math.floor(heights.length / 2);
  if (heights.length % 2 === 1) return heights[middle] ?? 0;
  const lower = heights[middle - 1] ?? 0;
  const upper = heights[middle] ?? 0;
  return (lower + upper) / 2;
}

const ALL_REGION_TYPES = Object.keys(REGION_LABELS) as LocalRedactionRegionType[];

export function redactedRegionTypes(): Set<LocalRedactionRegionType> {
  const configured = (process.env.PORTFOLIO_REDACTED_REGION_TYPES || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is LocalRedactionRegionType => value in REGION_LABELS);
  if (configured.length) return new Set(configured);
  return new Set(DEFAULT_REDACTED_REGION_TYPES);
}

export function smallTextMaxHeight() {
  const raw = Number(process.env.PORTFOLIO_SMALL_TEXT_MAX_HEIGHT);
  // 1 을 넣으면 높이 검사를 끄는 것과 같습니다.
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return DEFAULT_SMALL_TEXT_MAX_HEIGHT;
}

/** 문서 전체에서 읽어낸 공개용 제목을 모읍니다. 앞쪽 장표를 먼저 씁니다. */
export function manifestPublicTitles(
  manifest: { slides: { publicTitles?: string[] }[] },
  limit = 24,
) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const slide of manifest.slides) {
    for (const title of slide.publicTitles || []) {
      if (seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
      if (titles.length >= limit) return titles;
    }
  }
  return titles;
}

/** 이 장표에서 실제로 가릴 영역만 골라냅니다. 렌더링과 검증이 같은 값을 쓰게 합니다. */
export function redactableRegions<T extends { type: LocalRedactionRegionType; height?: number }>(
  regions: T[],
) {
  const allowed = redactedRegionTypes();
  const maxHeight = smallTextMaxHeight();
  const reference = slideTextReferenceHeight(regions);
  const ratio = smallTextRelativeRatio();
  return regions.filter((region) => {
    if (!allowed.has(region.type)) return false;
    // 작은 글씨로 기록됐어도 실제 높이가 본문 크기면 남깁니다.
    if (region.type === "small_text" && typeof region.height === "number") {
      if (region.height > maxHeight) return false;
      // 그 장표의 다른 글씨와 비슷한 크기면 잔글씨가 아니라 본문입니다.
      if (reference > 0 && region.height >= reference * ratio) return false;
      return true;
    }
    return true;
  });
}

export { ALL_REGION_TYPES };

export type LocalRedactionRegion = {
  slideIndex: number;
  type: LocalRedactionRegionType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LocalRedactionSlide = {
  slideIndex: number;
  sourceSlideNumber: number;
  inspectionStatus: "verified";
  /**
   * 장표에서 읽은 공개용 큰 제목.
   *
   * 이 글자가 없으면 서버는 문서가 무엇에 대한 것인지 전혀 모릅니다.
   * 그래서 "비즈니스 문서" 같은 분류만 보고 일반론만 쓴 글이 나왔습니다.
   * 워커가 식별자로 분류한 줄은 여기 담기지 않습니다.
   */
  publicTitles?: string[];
  regions: LocalRedactionRegion[];
};

export type LocalRedactionManifest = {
  version: typeof LOCAL_REDACTION_MANIFEST_VERSION;
  method: typeof LOCAL_REDACTION_MANIFEST_METHOD;
  sourceSlideCount: number;
  slideCount: number;
  slides: LocalRedactionSlide[];
};

export type LocalRedactionManifestValidation =
  | { ok: true; manifest: LocalRedactionManifest }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Exact geometric union of normalized redaction rectangles. */
export function localRedactionUnionCoverage(
  regions: readonly Pick<LocalRedactionRegion, "x" | "y" | "width" | "height">[],
) {
  if (!regions.length) return 0;
  const xCoordinates = [...new Set(regions.flatMap((region) => [
    region.x,
    region.x + region.width,
  ]))].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index + 1 < xCoordinates.length; index += 1) {
    const left = xCoordinates[index];
    const right = xCoordinates[index + 1];
    const width = right - left;
    if (width <= 0) continue;
    const intervals = regions
      .filter((region) => region.x < right && region.x + region.width > left)
      .map((region) => [region.y, region.y + region.height] as const)
      .sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    let coveredHeight = 0;
    let start: number | null = null;
    let end = 0;
    intervals.forEach(([nextStart, nextEnd]) => {
      if (start === null) {
        start = nextStart;
        end = nextEnd;
      } else if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        coveredHeight += end - start;
        start = nextStart;
        end = nextEnd;
      }
    });
    if (start !== null) coveredHeight += end - start;
    area += width * coveredHeight;
  }
  return Math.max(0, Math.min(1, area));
}

export type LocalRedactionSlideSafety = {
  slideIndex: number;
  safeForAutomaticDesign: boolean;
  hasFullSlideRegion: boolean;
  hasNearTotalCoverage: boolean;
  hasOversizedRegion: boolean;
  maxRegionCoverage: number;
  unionCoverage: number;
};

export function inspectLocalRedactionSlideSafety(
  slide: Pick<LocalRedactionSlide, "slideIndex" | "inspectionStatus" | "regions">,
): LocalRedactionSlideSafety {
  // 실제로 가릴 영역만 놓고 판단합니다. 가리지 않는 영역까지 세면 덮는 면적이 과대평가됩니다.
  const regions = redactableRegions(slide.regions);
  const maxRegionCoverage = regions.reduce(
    (maximum, region) => Math.max(maximum, region.width * region.height),
    0,
  );
  const unionCoverage = localRedactionUnionCoverage(regions);
  const hasFullSlideRegion = regions.some((region) => (
    region.x <= 0.000001
    && region.y <= 0.000001
    && region.x + region.width >= 0.999999
    && region.y + region.height >= 0.999999
  ));
  const hasOversizedRegion = maxRegionCoverage > MAX_AUTOMATIC_REDACTION_REGION_COVERAGE
    || unionCoverage > MAX_AUTOMATIC_REDACTION_UNION_COVERAGE;
  const hasNearTotalCoverage = maxRegionCoverage >= MAX_AUTOMATIC_REDACTION_TOTAL_COVERAGE
    || unionCoverage >= MAX_AUTOMATIC_REDACTION_TOTAL_COVERAGE;
  return {
    slideIndex: slide.slideIndex,
    // Large photos and dense body layouts can legitimately require a large
    // selective mask. Near-total masks, however, no longer communicate the
    // source design and reproduce the old blanket-blur failure in practice.
    safeForAutomaticDesign: slide.inspectionStatus === "verified"
      && !hasFullSlideRegion
      && !hasNearTotalCoverage,
    hasFullSlideRegion,
    hasNearTotalCoverage,
    hasOversizedRegion,
    maxRegionCoverage,
    unionCoverage,
  };
}

export function automaticDesignEligibleSlideIndexes(manifest: LocalRedactionManifest) {
  return manifest.slides
    .filter((slide) => inspectLocalRedactionSlideSafety(slide).safeForAutomaticDesign)
    .map((slide) => slide.slideIndex);
}

function validRegion(
  value: unknown,
  expectedSlideIndex: number,
): value is LocalRedactionRegion {
  if (!isRecord(value) || value.slideIndex !== expectedSlideIndex) return false;
  if (typeof value.type !== "string" || !(value.type in REGION_LABELS)) return false;
  const type = value.type as LocalRedactionRegionType;
  const allowedLabels = REGION_LABELS[type] as ReadonlySet<string>;
  if (typeof value.label !== "string" || !allowedLabels.has(value.label)) {
    return false;
  }
  if (![value.x, value.y, value.width, value.height].every(finiteNumber)) return false;
  const { x, y, width, height } = value as Record<"x" | "y" | "width" | "height", number>;
  return x >= 0
    && y >= 0
    && width >= 0.002
    && height >= 0.002
    && x <= 1
    && y <= 1
    && x + width <= 1.000001
    && y + height <= 1.000001;
}

export function validateLocalRedactionManifest(
  value: unknown,
  expectedSlideCount: number,
): LocalRedactionManifestValidation {
  if (!Number.isInteger(expectedSlideCount) || expectedSlideCount < 5 || expectedSlideCount > 100) {
    return { ok: false, error: "The expected slide count is invalid." };
  }
  if (!isRecord(value)) {
    return { ok: false, error: "A PowerPoint redaction manifest is required." };
  }
  if (value.version !== LOCAL_REDACTION_MANIFEST_VERSION) {
    return { ok: false, error: "Unsupported PowerPoint redaction manifest version." };
  }
  if (value.method !== LOCAL_REDACTION_MANIFEST_METHOD) {
    return { ok: false, error: "Unsupported PowerPoint redaction manifest method." };
  }
  if (!Number.isSafeInteger(value.sourceSlideCount)
    || Number(value.sourceSlideCount) < expectedSlideCount
    || Number(value.sourceSlideCount) > 10_000) {
    return { ok: false, error: "PowerPoint redaction manifest source slide count is invalid." };
  }
  if (value.slideCount !== expectedSlideCount || !Array.isArray(value.slides)) {
    return { ok: false, error: "PowerPoint redaction manifest slide count mismatch." };
  }
  if (value.slides.length !== expectedSlideCount) {
    return { ok: false, error: "PowerPoint redaction manifest must cover every exported slide." };
  }

  const slides: LocalRedactionSlide[] = [];
  let totalRegions = 0;
  let previousSourceSlideNumber = 0;
  for (let slideIndex = 0; slideIndex < expectedSlideCount; slideIndex += 1) {
    const rawSlide = value.slides[slideIndex];
    if (!isRecord(rawSlide)
      || rawSlide.slideIndex !== slideIndex
      || !Number.isInteger(rawSlide.sourceSlideNumber)
      || Number(rawSlide.sourceSlideNumber) < 1
      || Number(rawSlide.sourceSlideNumber) > Number(value.sourceSlideCount)
      || Number(rawSlide.sourceSlideNumber) <= previousSourceSlideNumber
      || rawSlide.inspectionStatus !== "verified"
      || !Array.isArray(rawSlide.regions)
      || rawSlide.regions.length > 2_000) {
      return { ok: false, error: `Invalid redaction data for exported slide ${slideIndex}.` };
    }
    if (!rawSlide.regions.every((region) => validRegion(region, slideIndex))) {
      return { ok: false, error: `Invalid redaction region for exported slide ${slideIndex}.` };
    }
    const regions = (rawSlide.regions as LocalRedactionRegion[]).map((region) => ({
      slideIndex,
      type: region.type,
      label: region.label,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    }));
    totalRegions += regions.length;
    if (totalRegions > 20_000) {
      return { ok: false, error: "PowerPoint redaction manifest contains too many regions." };
    }
    const publicTitles = Array.isArray(rawSlide.publicTitles)
      ? rawSlide.publicTitles
        .filter((title): title is string => typeof title === "string")
        .map((title) => title.replace(/\s+/g, " ").trim())
        .filter((title) => title.length >= 2 && title.length <= 120)
        .slice(0, 6)
      : [];
    slides.push({
      slideIndex,
      sourceSlideNumber: Number(rawSlide.sourceSlideNumber),
      inspectionStatus: "verified",
      ...(publicTitles.length ? { publicTitles } : {}),
      regions,
    });
    previousSourceSlideNumber = Number(rawSlide.sourceSlideNumber);
  }

  return {
    ok: true,
    manifest: {
      version: LOCAL_REDACTION_MANIFEST_VERSION,
      method: LOCAL_REDACTION_MANIFEST_METHOD,
      sourceSlideCount: Number(value.sourceSlideCount),
      slideCount: expectedSlideCount,
      slides,
    },
  };
}
