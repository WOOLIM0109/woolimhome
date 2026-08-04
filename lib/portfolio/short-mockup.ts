import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

type SharpOverlay = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

export const SHORT_DOCUMENT_MIN_SLIDES = 5;
export const SHORT_DOCUMENT_MAX_SLIDES = 19;
export const SHORT_MOCKUP_MAX_SELECTED_SLIDES = 14;

export type SupportedShortMockupAspectClass =
  | "16:9"
  | "4:3"
  | "a4_landscape"
  | "a4_portrait";

export type ShortMockupAspectClass = SupportedShortMockupAspectClass | "unknown";

export type ShortMockupSlide = {
  /** Zero-based index in the source deck. */
  index: number;
  /** An already-oriented, already-redacted PNG/JPEG slide. */
  buffer: Buffer;
};

export type ShortMockupBoard = {
  kind: "body_image";
  name: "short-main.jpg" | "short-detail-1.jpg" | "short-detail-2.jpg" | "short-detail-3.jpg";
  bytes: Buffer;
  caption: string;
  slideIndexes: number[];
  slideAspectRatio: number;
  width: number;
  height: number;
};

export type ShortMockupResult = {
  /** Canonical metadata value consumed by the admin work queue. */
  mode: "short_psd";
  aspectClass: SupportedShortMockupAspectClass;
  selectedSlideIndexes: number[];
  selectedSlideCount: number;
  bodyBoardCount: 4;
  boards: ShortMockupBoard[];
};

type PreparedSlide = ShortMockupSlide & {
  buffer: Buffer;
  width: number;
  height: number;
  aspectRatio: number;
};

type RenderedCard = {
  buffer: Buffer;
  width: number;
  height: number;
};

type CardSlot = {
  centerX: number;
  centerY: number;
  maxWidth: number;
  maxHeight: number;
  angle: number;
  z: number;
};

type TemplateMainSlot = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  z: number;
};

type TemplateDetailSlot = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const MAIN_CANVAS = { width: 1600, height: 1600 } as const;
const DETAIL_CANVAS = { width: 1600, height: 900 } as const;
const ASPECT_RATIOS: Record<SupportedShortMockupAspectClass, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  a4_landscape: Math.SQRT2,
  a4_portrait: 1 / Math.SQRT2,
};

const PSD_TEMPLATE_ASPECTS = new Set<SupportedShortMockupAspectClass>(["16:9", "4:3"]);
const PSD_SOURCE_MAIN_SIZE = 1920;
const PSD_SOURCE_DETAIL_SIZE = { width: 1920, height: 1080 } as const;
const templateAssetCache = new Map<string, Promise<Buffer>>();

const TEMPLATE_MAIN_SLOTS: Record<"16:9" | "4:3", TemplateMainSlot[]> = {
  "16:9": [
    { left: 93, top: 300, right: 1834, bottom: 1685, z: 5 },
    { left: -461, top: -7, right: 982, bottom: 571, z: 4 },
    { left: 1133, top: -7, right: 2443, bottom: 1317, z: 3 },
    { left: -461, top: 564, right: 607, bottom: 1847, z: 2 },
    { left: 783, top: 1309, right: 2443, bottom: 1929, z: 1 },
  ],
  "4:3": [
    { left: 759, top: -23, right: 1935, bottom: 1012, z: 5 },
    { left: -255, top: 385, right: 953, bottom: 1444, z: 4 },
    { left: 834, top: 800, right: 1935, bottom: 1861, z: 2 },
    { left: -220, top: 1252, right: 984, bottom: 1977, z: 1 },
  ],
};

const TEMPLATE_DETAIL_SLOTS: Record<"16:9" | "4:3", TemplateDetailSlot[][]> = {
  "16:9": [
    [],
    [
      { left: 253, top: 130, right: 1667, bottom: 926 },
      { left: -1298, top: 130, right: 116, bottom: 926 },
      { left: 1804, top: 130, right: 3218, bottom: 926 },
    ],
    [
      { left: 253, top: 142, right: 1667, bottom: 938 },
      { left: -1298, top: 142, right: 116, bottom: 938 },
      { left: 1804, top: 142, right: 3218, bottom: 938 },
    ],
    [
      { left: 253, top: 142, right: 1667, bottom: 938 },
      { left: -1298, top: 142, right: 116, bottom: 938 },
      { left: 1804, top: 142, right: 3218, bottom: 938 },
    ],
  ],
  "4:3": [
    [],
    [
      { left: 484, top: 171, right: 1435, bottom: 884 },
      { left: -568, top: 171, right: 383, bottom: 884 },
      { left: 1536, top: 171, right: 2487, bottom: 884 },
    ],
    [
      { left: 484, top: 183, right: 1435, bottom: 896 },
      { left: -568, top: 183, right: 383, bottom: 896 },
      { left: 1536, top: 183, right: 2487, bottom: 896 },
    ],
    [
      { left: 484, top: 185, right: 1435, bottom: 898 },
      { left: -568, top: 185, right: 383, bottom: 898 },
      { left: 1536, top: 185, right: 2487, bottom: 898 },
    ],
  ],
};

const BOARD_CAPTIONS = [
  "문서의 핵심 디자인과 대표 도식을 한눈에 보여주는 메인 포트폴리오 목업",
  "완성도 높은 도식과 정보 구조를 선별해 보여주는 상세 포트폴리오 목업",
  "문서 전반의 시각적 변주와 보기 드문 레이아웃을 보여주는 상세 포트폴리오 목업",
  "주요 장표의 색상과 그리드, 정보 위계를 보여주는 상세 포트폴리오 목업",
] as const;

const BOARD_NAMES = [
  "short-main.jpg",
  "short-detail-1.jpg",
  "short-detail-2.jpg",
  "short-detail-3.jpg",
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: number[]) {
  if (!values.length) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Classifies a slide by the closest supported document ratio. The tight
 * tolerance accepts normal export rounding while blocking unusual canvas
 * shapes that need a human decision.
 */
export function classifyShortMockupAspectRatio(ratio: number): ShortMockupAspectClass {
  if (!Number.isFinite(ratio) || ratio <= 0) return "unknown";
  const candidates = (Object.entries(ASPECT_RATIOS) as Array<[
    SupportedShortMockupAspectClass,
    number,
  ]>).map(([aspectClass, expected]) => ({
    aspectClass,
    distance: Math.abs(ratio - expected) / expected,
  }));
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0].distance <= 0.025 ? candidates[0].aspectClass : "unknown";
}

export function shortMockupAspectRatio(aspectClass: SupportedShortMockupAspectClass) {
  return ASPECT_RATIOS[aspectClass];
}

function uniqueSelectedSlides(slides: ShortMockupSlide[]) {
  const byIndex = new Map<number, ShortMockupSlide>();
  const contentHashes = new Set<string>();
  for (const slide of slides) {
    if (!Number.isInteger(slide.index) || slide.index < 0) {
      throw new Error("짧은 문서 목업의 장표 인덱스는 0 이상의 정수여야 합니다.");
    }
    if (!Buffer.isBuffer(slide.buffer) || slide.buffer.length === 0) {
      throw new Error(`장표 ${slide.index + 1}의 이미지 데이터가 비어 있습니다.`);
    }
    const contentHash = createHash("sha256").update(slide.buffer).digest("hex");
    if (!byIndex.has(slide.index) && !contentHashes.has(contentHash)) {
      byIndex.set(slide.index, slide);
      contentHashes.add(contentHash);
    }
  }
  return [...byIndex.values()].slice(0, SHORT_MOCKUP_MAX_SELECTED_SLIDES);
}

async function prepareSlide(slide: ShortMockupSlide): Promise<PreparedSlide> {
  const oriented = await sharp(slide.buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  if (!oriented.info.width || !oriented.info.height) {
    throw new Error(`장표 ${slide.index + 1}의 크기를 확인할 수 없습니다.`);
  }
  return {
    ...slide,
    buffer: oriented.data,
    width: oriented.info.width,
    height: oriented.info.height,
    aspectRatio: oriented.info.width / oriented.info.height,
  };
}

function containedSize(ratio: number, maxWidth: number, maxHeight: number) {
  if (maxWidth / maxHeight > ratio) {
    const height = Math.round(maxHeight);
    return { width: Math.max(1, Math.round(height * ratio)), height };
  }
  const width = Math.round(maxWidth);
  return { width, height: Math.max(1, Math.round(width / ratio)) };
}

function cardShadowSvg(width: number, height: number, padding: number) {
  const totalWidth = width + padding * 2;
  const totalHeight = height + padding * 2;
  return Buffer.from(`<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-35%" y="-35%" width="170%" height="185%">
        <feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#2c2a31" flood-opacity=".22"/>
        <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#17151b" flood-opacity=".13"/>
      </filter>
      <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#ffffff"/>
        <stop offset="1" stop-color="#fbfbfa"/>
      </linearGradient>
    </defs>
    <rect x="${padding}" y="${padding - 5}" width="${width}" height="${height}" rx="7" fill="url(#paper)" filter="url(#shadow)"/>
  </svg>`);
}

async function renderCard(
  slide: PreparedSlide,
  options: { maxWidth: number; maxHeight: number; angle?: number },
): Promise<RenderedCard> {
  const mat = 10;
  const shadowPadding = 52;
  const content = containedSize(slide.aspectRatio, options.maxWidth, options.maxHeight);
  const fitted = await sharp(slide.buffer)
    .resize({
      width: content.width,
      height: content.height,
      fit: "contain",
      background: "#ffffff",
      withoutEnlargement: false,
    })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer();
  const paperWidth = content.width + mat * 2;
  const paperHeight = content.height + mat * 2;
  const unrotated = await sharp({
    create: {
      width: paperWidth + shadowPadding * 2,
      height: paperHeight + shadowPadding * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    {
      input: cardShadowSvg(paperWidth, paperHeight, shadowPadding),
      left: 0,
      top: 0,
    },
    {
      input: Buffer.from(`<svg width="${paperWidth}" height="${paperHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect x=".75" y=".75" width="${paperWidth - 1.5}" height="${paperHeight - 1.5}" rx="6" fill="#ffffff" stroke="#ffffff" stroke-width="1.5"/>
      </svg>`),
      left: shadowPadding,
      top: shadowPadding - 5,
    },
    {
      input: fitted,
      left: shadowPadding + mat,
      top: shadowPadding - 5 + mat,
    },
    {
      input: Buffer.from(`<svg width="${content.width}" height="${content.height}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#ffffff" stop-opacity=".10"/>
          <stop offset=".45" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity=".035"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#shine)"/>
      </svg>`),
      left: shadowPadding + mat,
      top: shadowPadding - 5 + mat,
    },
  ]).png().toBuffer();

  const angle = options.angle || 0;
  const rendered = angle
    ? await sharp(unrotated)
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true })
    : await sharp(unrotated).png().toBuffer({ resolveWithObject: true });
  return {
    buffer: rendered.data,
    width: rendered.info.width,
    height: rendered.info.height,
  };
}

function backgroundSvg(width: number, height: number, variant: number) {
  const palettes = [
    ["#f8f7f4", "#e8e7e4", "#d9d8d5"],
    ["#f7f7f6", "#e7e7e5", "#d5d5d2"],
    ["#faf9f7", "#ebe9e6", "#dcd9d5"],
    ["#f8f8f7", "#e9e8e5", "#d8d7d3"],
  ] as const;
  const [start, middle, end] = palettes[variant % palettes.length];
  const highlightX = variant % 2 ? 28 : 72;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${start}"/>
        <stop offset=".55" stop-color="${middle}"/>
        <stop offset="1" stop-color="${end}"/>
      </linearGradient>
      <radialGradient id="light" cx="${highlightX}%" cy="18%" r="82%">
        <stop stop-color="#ffffff" stop-opacity=".94"/>
        <stop offset=".48" stop-color="#ffffff" stop-opacity=".24"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="1" stop-color="#bbb9b5" stop-opacity=".19"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#base)"/>
    <rect width="100%" height="100%" fill="url(#light)"/>
    <rect y="${Math.round(height * 0.58)}" width="100%" height="${Math.round(height * 0.42)}" fill="url(#floor)"/>
    <path d="M-${Math.round(width * 0.06)} ${Math.round(height * 0.17)} L${Math.round(width * 1.04)} ${Math.round(height * 0.03)}" stroke="#ffffff" stroke-opacity=".38" stroke-width="3"/>
  </svg>`);
}

function psdTemplateAspect(
  aspectClass: SupportedShortMockupAspectClass,
): aspectClass is "16:9" | "4:3" {
  return PSD_TEMPLATE_ASPECTS.has(aspectClass);
}

function templateAsset(
  aspectClass: "16:9" | "4:3",
  boardIndex: number,
) {
  const slug = aspectClass === "16:9" ? "16-9" : "4-3";
  const board = boardIndex === 0 ? "main" : `detail-${boardIndex}`;
  const key = `${slug}-${board}`;
  const existing = templateAssetCache.get(key);
  if (existing) return existing;
  const pending = readFile(path.join(
    process.cwd(),
    "public",
    "portfolio",
    "mockup-templates",
    `${key}.jpg`,
  ));
  templateAssetCache.set(key, pending);
  return pending;
}

async function clippedPlacement(input: Buffer, options: {
  width: number;
  height: number;
  left: number;
  top: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const sourceLeft = Math.max(0, -options.left);
  const sourceTop = Math.max(0, -options.top);
  const left = Math.max(0, options.left);
  const top = Math.max(0, options.top);
  const width = Math.min(
    options.width - sourceLeft,
    options.canvasWidth - left,
  );
  const height = Math.min(
    options.height - sourceTop,
    options.canvasHeight - top,
  );
  if (width <= 0 || height <= 0) return null;
  if (sourceLeft === 0
    && sourceTop === 0
    && width === options.width
    && height === options.height) {
    return { input, left, top };
  }
  return {
    input: await sharp(input).extract({
      left: sourceLeft,
      top: sourceTop,
      width,
      height,
    }).png().toBuffer(),
    left,
    top,
  };
}

async function renderPsdMainBoard(
  slides: PreparedSlide[],
  aspectClass: "16:9" | "4:3",
) {
  const slots = TEMPLATE_MAIN_SLOTS[aspectClass].slice(0, slides.length);
  const ratio = ASPECT_RATIOS[aspectClass];
  const scale = MAIN_CANVAS.width / PSD_SOURCE_MAIN_SIZE;
  const placements = await Promise.all(slides.map(async (slide, index) => {
    const slot = slots[index];
    const boundingWidth = (slot.right - slot.left) * scale;
    const boundingHeight = (slot.bottom - slot.top) * scale;
    const boundingRatio = boundingWidth / boundingHeight;
    const tangent = (ratio - boundingRatio) / Math.max(0.0001, boundingRatio * ratio - 1);
    const angle = Math.atan(tangent);
    const sine = Math.abs(Math.sin(angle));
    const cosine = Math.abs(Math.cos(angle));
    const fittedHeight = Math.min(
      boundingWidth / Math.max(0.0001, ratio * cosine + sine),
      boundingHeight / Math.max(0.0001, ratio * sine + cosine),
    );
    const inset = 0.91;
    const height = Math.max(1, Math.round(fittedHeight * inset));
    const width = Math.max(1, Math.round(height * ratio));
    const rendered = await sharp(slide.buffer)
      .resize({ width, height, fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .ensureAlpha()
      .rotate(angle * 180 / Math.PI, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const centerX = ((slot.left + slot.right) / 2) * scale;
    const centerY = ((slot.top + slot.bottom) / 2) * scale;
    const placement = await clippedPlacement(rendered.data, {
      width: rendered.info.width,
      height: rendered.info.height,
      left: Math.round(centerX - rendered.info.width / 2),
      top: Math.round(centerY - rendered.info.height / 2),
      canvasWidth: MAIN_CANVAS.width,
      canvasHeight: MAIN_CANVAS.height,
    });
    return placement ? { ...placement, z: slot.z } : null;
  }));
  return sharp(await templateAsset(aspectClass, 0))
    .composite(placements
      .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement))
      .sort((left, right) => left.z - right.z)
      .map(({ input, left, top }) => ({ input, left, top })))
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

async function renderPsdDetailBoard(
  slides: PreparedSlide[],
  aspectClass: "16:9" | "4:3",
  boardIndex: number,
) {
  const slots = TEMPLATE_DETAIL_SLOTS[aspectClass][boardIndex].slice(0, slides.length);
  const scaleX = DETAIL_CANVAS.width / PSD_SOURCE_DETAIL_SIZE.width;
  const scaleY = DETAIL_CANVAS.height / PSD_SOURCE_DETAIL_SIZE.height;
  const placements = await Promise.all(slides.map(async (slide, index) => {
    const slot = slots[index];
    const width = Math.max(1, Math.round((slot.right - slot.left) * scaleX));
    const height = Math.max(1, Math.round((slot.bottom - slot.top) * scaleY));
    const input = await sharp(slide.buffer)
      .resize({ width, height, fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    return clippedPlacement(input, {
      width,
      height,
      left: Math.round(slot.left * scaleX),
      top: Math.round(slot.top * scaleY),
      canvasWidth: DETAIL_CANVAS.width,
      canvasHeight: DETAIL_CANVAS.height,
    });
  }));
  return sharp(await templateAsset(aspectClass, boardIndex))
    .composite(placements.filter((placement): placement is NonNullable<typeof placement> => Boolean(placement)))
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

function mainSlots(count: number): CardSlot[] {
  const templates: Record<number, CardSlot[]> = {
    2: [
      { centerX: 570, centerY: 620, maxWidth: 760, maxHeight: 610, angle: -5, z: 2 },
      { centerX: 1040, centerY: 1000, maxWidth: 760, maxHeight: 610, angle: 5, z: 1 },
    ],
    3: [
      { centerX: 800, centerY: 800, maxWidth: 820, maxHeight: 620, angle: -1, z: 3 },
      { centerX: 420, centerY: 360, maxWidth: 610, maxHeight: 470, angle: -6, z: 1 },
      { centerX: 1180, centerY: 1240, maxWidth: 610, maxHeight: 470, angle: 6, z: 2 },
    ],
    4: [
      { centerX: 800, centerY: 800, maxWidth: 780, maxHeight: 590, angle: -1, z: 4 },
      { centerX: 390, centerY: 350, maxWidth: 570, maxHeight: 430, angle: -6, z: 1 },
      { centerX: 1210, centerY: 390, maxWidth: 570, maxHeight: 430, angle: 6, z: 2 },
      { centerX: 970, centerY: 1240, maxWidth: 570, maxHeight: 430, angle: -5, z: 3 },
    ],
    5: [
      { centerX: 800, centerY: 800, maxWidth: 760, maxHeight: 570, angle: -1, z: 5 },
      { centerX: 365, centerY: 335, maxWidth: 545, maxHeight: 410, angle: -6, z: 1 },
      { centerX: 1235, centerY: 335, maxWidth: 545, maxHeight: 410, angle: 6, z: 2 },
      { centerX: 365, centerY: 1265, maxWidth: 545, maxHeight: 410, angle: 5, z: 3 },
      { centerX: 1235, centerY: 1265, maxWidth: 545, maxHeight: 410, angle: -5, z: 4 },
    ],
  };
  return templates[count] || templates[5].slice(0, count);
}

function detailSlots(count: number, variant: number): CardSlot[] {
  const direction = variant % 2 ? -1 : 1;
  if (count === 1) {
    return [{
      centerX: 800,
      centerY: 450,
      maxWidth: 1170,
      maxHeight: 680,
      angle: direction * 0.6,
      z: 1,
    }];
  }
  if (count === 2) {
    return [
      { centerX: 445, centerY: 450, maxWidth: 660, maxHeight: 660, angle: -direction * 1.5, z: 1 },
      { centerX: 1155, centerY: 450, maxWidth: 660, maxHeight: 660, angle: direction * 1.5, z: 2 },
    ];
  }
  return [
    { centerX: 290, centerY: 450, maxWidth: 440, maxHeight: 630, angle: -direction * 1.4, z: 1 },
    { centerX: 800, centerY: 450, maxWidth: 480, maxHeight: 675, angle: direction * 0.4, z: 3 },
    { centerX: 1310, centerY: 450, maxWidth: 440, maxHeight: 630, angle: direction * 1.4, z: 2 },
  ];
}

function boardSlideCounts(slideCount: number, aspectClass: SupportedShortMockupAspectClass) {
  const counts = [2, 1, 1, 1];
  const capacity = [aspectClass === "4:3" ? 4 : 5, 3, 3, 3];
  let remaining = slideCount - counts.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  while (remaining > 0) {
    const board = cursor % counts.length;
    if (counts[board] < capacity[board]) {
      counts[board] += 1;
      remaining -= 1;
    }
    cursor += 1;
  }
  return counts;
}

function splitSlidesAcrossBoards(
  slides: PreparedSlide[],
  aspectClass: SupportedShortMockupAspectClass,
) {
  const counts = boardSlideCounts(slides.length, aspectClass);
  let cursor = 0;
  return counts.map((count) => {
    const group = slides.slice(cursor, cursor + count);
    cursor += count;
    return group;
  });
}

async function renderBoard(
  slides: PreparedSlide[],
  boardIndex: number,
  aspectClass: SupportedShortMockupAspectClass,
): Promise<ShortMockupBoard> {
  const canvas = boardIndex === 0 ? MAIN_CANVAS : DETAIL_CANVAS;
  if (psdTemplateAspect(aspectClass)) {
    const bytes = boardIndex === 0
      ? await renderPsdMainBoard(slides, aspectClass)
      : await renderPsdDetailBoard(slides, aspectClass, boardIndex);
    return {
      kind: "body_image",
      name: BOARD_NAMES[boardIndex],
      bytes,
      caption: BOARD_CAPTIONS[boardIndex],
      slideIndexes: slides.map((slide) => slide.index),
      slideAspectRatio: median(slides.map((slide) => slide.aspectRatio)),
      width: canvas.width,
      height: canvas.height,
    };
  }
  const slots = boardIndex === 0
    ? mainSlots(slides.length)
    : detailSlots(slides.length, boardIndex);
  const cards = await Promise.all(slides.map((slide, index) => renderCard(slide, {
    maxWidth: slots[index].maxWidth,
    maxHeight: slots[index].maxHeight,
    angle: slots[index].angle,
  })));
  const placements = cards.map((card, index) => ({
    input: card.buffer,
    left: clamp(Math.round(slots[index].centerX - card.width / 2), 0, canvas.width - card.width),
    top: clamp(Math.round(slots[index].centerY - card.height / 2), 0, canvas.height - card.height),
    z: slots[index].z,
  })).sort((left, right) => left.z - right.z);
  const composites: SharpOverlay[] = [
    { input: backgroundSvg(canvas.width, canvas.height, boardIndex), left: 0, top: 0 },
    ...placements.map(({ input, left, top }) => ({ input, left, top })),
  ];
  const bytes = await sharp({
    create: {
      ...canvas,
      channels: 3,
      background: "#efefed",
    },
  }).composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  return {
    kind: "body_image",
    name: BOARD_NAMES[boardIndex],
    bytes,
    caption: BOARD_CAPTIONS[boardIndex],
    slideIndexes: slides.map((slide) => slide.index),
    slideAspectRatio: median(slides.map((slide) => slide.aspectRatio)),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Renders the four blog boards used for short (5-19 slide) portfolio decks.
 *
 * The input buffers must already have confidential text and images blurred.
 * This module intentionally has no Photoshop runtime dependency. The supplied
 * 16:9 and 4:3 PSD backgrounds, shadows, and paper frames are pre-rendered as
 * fixed assets; A4 pages use the matching light-background layout. Every slide
 * is resized with `contain`, so its contents are never stretched or cropped.
 */
export async function renderShortDocumentMockups(input: {
  deckSlideCount: number;
  aspectClass: SupportedShortMockupAspectClass;
  slides: ShortMockupSlide[];
}): Promise<ShortMockupResult> {
  if (!Number.isInteger(input.deckSlideCount)
    || input.deckSlideCount < SHORT_DOCUMENT_MIN_SLIDES
    || input.deckSlideCount > SHORT_DOCUMENT_MAX_SLIDES) {
    throw new Error("짧은 문서 목업은 전체 장수가 5~19장인 문서에만 적용할 수 있습니다.");
  }
  if (!(input.aspectClass in ASPECT_RATIOS)) {
    throw new Error("지원하지 않는 문서 규격입니다. 16:9, 4:3, A4 가로 또는 A4 세로를 사용해 주세요.");
  }
  const selected = uniqueSelectedSlides(input.slides)
    .slice(0, input.aspectClass === "4:3" ? 13 : SHORT_MOCKUP_MAX_SELECTED_SLIDES);
  if (selected.length < SHORT_DOCUMENT_MIN_SLIDES) {
    throw new Error("짧은 문서 목업에는 중복되지 않는 장표 이미지가 최소 5개 필요합니다.");
  }
  if (selected.some((slide) => slide.index >= input.deckSlideCount)) {
    throw new Error("선택한 장표 인덱스가 전체 문서 장수를 벗어났습니다.");
  }
  const prepared = await Promise.all(selected.map(prepareSlide));
  const groups = splitSlidesAcrossBoards(prepared, input.aspectClass);
  const boards = await Promise.all(groups.map((group, boardIndex) => renderBoard(
    group,
    boardIndex,
    input.aspectClass,
  )));
  return {
    mode: "short_psd",
    aspectClass: input.aspectClass,
    selectedSlideIndexes: prepared.map((slide) => slide.index),
    selectedSlideCount: prepared.length,
    bodyBoardCount: 4,
    boards,
  };
}
