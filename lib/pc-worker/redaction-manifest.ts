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
 * 지금까지는 워커가 보낸 모든 영역을 예외 없이 가렸습니다.
 * 본문 글자와 표까지 전부 대상이라 장표가 통째로 뭉개져 보였습니다.
 *
 * 기본 정책은 다음만 가립니다.
 *   · 고객사 상호명과 프로젝트명
 *   · 개인정보 (이름·연락처·주소·사업자등록번호 등은 워커가 식별자로 분류합니다)
 *   · 작은 글씨 (18pt 미만. 세부 수치와 주석이 몰려 있습니다)
 *   · 로고와 바닥글
 *   · 사진과 화면 캡처 (사람 얼굴이나 내부 화면이 그대로 남을 수 있습니다)
 *
 * 남기는 것: 본문 글자, 표 내용, 차트 라벨, 큰 제목.
 * 환경변수 PORTFOLIO_REDACTED_REGION_TYPES 로 조정할 수 있습니다.
 */
/**
 * 권장 정책. 환경변수에 이 값을 넣으면 적용됩니다.
 *
 *   PORTFOLIO_REDACTED_REGION_TYPES=client_identifier,project_identifier,small_text,logo,footer,embedded_photo,screenshot
 *
 * 기본값은 지금까지와 같이 모든 영역을 가립니다.
 * 가리는 범위를 줄이는 것은 고객사 기밀이 걸린 결정이라,
 * 담당자가 실제 결과를 확인한 뒤 직접 켜도록 두었습니다.
 * 마음에 들지 않으면 환경변수만 지우면 즉시 원래대로 돌아갑니다.
 */
export const RECOMMENDED_REDACTED_REGION_TYPES: LocalRedactionRegionType[] = [
  "client_identifier",
  "project_identifier",
  "small_text",
  "logo",
  "footer",
  "embedded_photo",
  "screenshot",
];

const ALL_REGION_TYPES = Object.keys(REGION_LABELS) as LocalRedactionRegionType[];

export function redactedRegionTypes(): Set<LocalRedactionRegionType> {
  const configured = (process.env.PORTFOLIO_REDACTED_REGION_TYPES || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is LocalRedactionRegionType => value in REGION_LABELS);
  return new Set(configured.length ? configured : ALL_REGION_TYPES);
}

/** 이 장표에서 실제로 가릴 영역만 골라냅니다. 렌더링과 검증이 같은 값을 쓰게 합니다. */
export function redactableRegions<T extends { type: LocalRedactionRegionType }>(regions: T[]) {
  const allowed = redactedRegionTypes();
  return regions.filter((region) => allowed.has(region.type));
}

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
    slides.push({
      slideIndex,
      sourceSlideNumber: Number(rawSlide.sourceSlideNumber),
      inspectionStatus: "verified",
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
