export const LOCAL_REDACTION_MANIFEST_VERSION = 1 as const;
export const LOCAL_REDACTION_MANIFEST_METHOD = "powerpoint_com_shapes_v1" as const;

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
    "local_group",
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
  regions: LocalRedactionRegion[];
};

export type LocalRedactionManifest = {
  version: typeof LOCAL_REDACTION_MANIFEST_VERSION;
  method: typeof LOCAL_REDACTION_MANIFEST_METHOD;
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
      || Number(rawSlide.sourceSlideNumber) <= previousSourceSlideNumber
      || !Array.isArray(rawSlide.regions)
      || rawSlide.regions.length < 1
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
      regions,
    });
    previousSourceSlideNumber = Number(rawSlide.sourceSlideNumber);
  }

  return {
    ok: true,
    manifest: {
      version: LOCAL_REDACTION_MANIFEST_VERSION,
      method: LOCAL_REDACTION_MANIFEST_METHOD,
      slideCount: expectedSlideCount,
      slides,
    },
  };
}
