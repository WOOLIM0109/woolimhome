import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  APPROVED_16X9_BODY_TEMPLATE_LIST,
  APPROVED_16X9_TEMPLATE_VERSION,
  resolveApprovedMockupSlots,
} from "./approved-16x9-templates.ts";
import { renderApproved16x9Mockup } from "./approved-16x9-renderer.ts";

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
  mockupTemplateId?: string;
  mockupTemplateVersion?: string;
  slotAssignments?: Array<{ slotId: string; slideIndex: number }>;
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

type Point = {
  x: number;
  y: number;
};

type TemplateMainSlot = {
  /** Exact Photoshop smart-object corner order: top-left, top-right, bottom-right, bottom-left. */
  quad: [Point, Point, Point, Point];
  sourceWidth: number;
  sourceHeight: number;
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
    {
      quad: [
        { x: 431.776526091558, y: 298.581333579507 },
        { x: 1835.43678108631, y: 890.85659953286 },
        { x: 1502.24621661248, y: 1686.8499973935 },
        { x: 89.9941587551383, y: 1085.06159091672 },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
      z: 5,
    },
    {
      quad: [
        { x: -363.050793804126, y: -614.744468503333 },
        { x: 1018.90396001652, y: -89.2766596343548 },
        { x: 671.552825297408, y: 723.573179446508 },
        { x: -720.631549874383, y: 137.115564415295 },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
      z: 4,
    },
    {
      quad: [
        { x: 1400.00869363833, y: -35.028454962057 },
        { x: 2787.71306130281, y: 545.414167234811 },
        { x: 2465.3453351941, y: 1327.40014150105 },
        { x: 1071.06124843036, y: 737.340867309569 },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
      z: 3,
    },
    {
      quad: [
        { x: -669.560901838942, y: 475.322249564231 },
        { x: 719.131274048473, y: 1058.1248803899 },
        { x: 375.606790915314, y: 1848.95012823353 },
        { x: -996.173317755546, y: 1265.09281023894 },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
      z: 2,
    },
    {
      quad: [
        { x: 1110.79847534423, y: 1077.7089939884 },
        { x: 2510.88101081293, y: 1670.128214362 },
        { x: 2185.92010639911, y: 2472.27159192145 },
        { x: 782.239622466352, y: 1863.18991042379 },
      ],
      sourceWidth: 1920,
      sourceHeight: 1080,
      z: 1,
    },
  ],
  "4:3": [
    {
      quad: [
        { x: 759.017314487709, y: 349.069210899718 },
        { x: 1698.09994932432, y: -59.2928529037284 },
        { x: 1982.19914261062, y: 604.892818684409 },
        { x: 1043.28059445042, y: 1010.90173846867 },
      ],
      sourceWidth: 1748,
      sourceHeight: 1240,
      z: 5,
    },
    {
      quad: [
        { x: -254.912277357436, y: 789.860045631124 },
        { x: 669.061303529236, y: 385.658163439083 },
        { x: 953.177891346973, y: 1048.60582886046 },
        { x: 29.5602184937884, y: 1443.43807917504 },
      ],
      sourceWidth: 1748,
      sourceHeight: 1240,
      z: 4,
    },
    {
      quad: [
        { x: 833.798392268207, y: 1201.1511531385 },
        { x: 1771.08269229614, y: 801.185699894781 },
        { x: 2055.77189581607, y: 1465.8156365933 },
        { x: 1116.83417375557, y: 1860.96771989251 },
      ],
      sourceWidth: 1748,
      sourceHeight: 1240,
      z: 2,
    },
    {
      quad: [
        { x: -220.037179134823, y: 1645.49105898018 },
        { x: 698.620420363765, y: 1252.68013241094 },
        { x: 983.405863288002, y: 1910.44715676418 },
        { x: 61.3417353202326, y: 2289.54117159896 },
      ],
      sourceWidth: 1748,
      sourceHeight: 1240,
      z: 1,
    },
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

function solveLinearSystem(rows: number[][]) {
  const size = rows.length;
  const matrix = rows.map((row) => [...row]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[best][pivot])) best = row;
    }
    if (Math.abs(matrix[best][pivot]) < 1e-10) {
      throw new Error("PSD 목업 원근 좌표를 계산할 수 없습니다.");
    }
    [matrix[pivot], matrix[best]] = [matrix[best], matrix[pivot]];
    const divisor = matrix[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      matrix[pivot][column] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        matrix[row][column] -= factor * matrix[pivot][column];
      }
    }
  }
  return matrix.map((row) => row[size]);
}

function homography(
  sourceWidth: number,
  sourceHeight: number,
  quad: [Point, Point, Point, Point],
) {
  const source = [
    { x: 0, y: 0 },
    { x: sourceWidth - 1, y: 0 },
    { x: sourceWidth - 1, y: sourceHeight - 1 },
    { x: 0, y: sourceHeight - 1 },
  ];
  const rows: number[][] = [];
  for (let index = 0; index < source.length; index += 1) {
    const { x, y } = source[index];
    const { x: outputX, y: outputY } = quad[index];
    rows.push([x, y, 1, 0, 0, 0, -outputX * x, -outputX * y, outputX]);
    rows.push([0, 0, 0, x, y, 1, -outputY * x, -outputY * y, outputY]);
  }
  const values = solveLinearSystem(rows);
  return [
    values[0], values[1], values[2],
    values[3], values[4], values[5],
    values[6], values[7], 1,
  ];
}

function invertMatrix3(values: number[]) {
  const [a, b, c, d, e, f, g, h, i] = values;
  const determinant = a * (e * i - f * h)
    - b * (d * i - f * g)
    + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-10) {
    throw new Error("PSD 목업 원근 좌표의 역행렬을 계산할 수 없습니다.");
  }
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
}

async function perspectivePlacement(
  slide: PreparedSlide,
  slot: TemplateMainSlot,
) {
  const scale = MAIN_CANVAS.width / PSD_SOURCE_MAIN_SIZE;
  const quad = slot.quad.map((point) => ({
    x: point.x * scale,
    y: point.y * scale,
  })) as [Point, Point, Point, Point];
  const left = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.y))));
  const right = Math.min(MAIN_CANVAS.width, Math.ceil(Math.max(...quad.map((point) => point.x))));
  const bottom = Math.min(MAIN_CANVAS.height, Math.ceil(Math.max(...quad.map((point) => point.y))));
  if (right <= left || bottom <= top) return null;

  const source = await sharp(slide.buffer)
    .resize({
      width: slot.sourceWidth,
      height: slot.sourceHeight,
      fit: "contain",
      background: "#ffffff",
    })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const inverse = invertMatrix3(homography(source.info.width, source.info.height, quad));
  const width = right - left;
  const height = bottom - top;
  const output = Buffer.alloc(width * height * 4);

  for (let outputY = 0; outputY < height; outputY += 1) {
    const canvasY = top + outputY + 0.5;
    for (let outputX = 0; outputX < width; outputX += 1) {
      const canvasX = left + outputX + 0.5;
      const divisor = inverse[6] * canvasX + inverse[7] * canvasY + inverse[8];
      if (Math.abs(divisor) < 1e-10) continue;
      const sourceX = (inverse[0] * canvasX + inverse[1] * canvasY + inverse[2]) / divisor;
      const sourceY = (inverse[3] * canvasX + inverse[4] * canvasY + inverse[5]) / divisor;
      if (sourceX < 0 || sourceY < 0
        || sourceX > source.info.width - 1
        || sourceY > source.info.height - 1) continue;

      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(source.info.width - 1, x0 + 1);
      const y1 = Math.min(source.info.height - 1, y0 + 1);
      const weightX = sourceX - x0;
      const weightY = sourceY - y0;
      const outputOffset = (outputY * width + outputX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.data[(y0 * source.info.width + x0) * 4 + channel];
        const topRight = source.data[(y0 * source.info.width + x1) * 4 + channel];
        const bottomLeft = source.data[(y1 * source.info.width + x0) * 4 + channel];
        const bottomRight = source.data[(y1 * source.info.width + x1) * 4 + channel];
        const topValue = topLeft + (topRight - topLeft) * weightX;
        const bottomValue = bottomLeft + (bottomRight - bottomLeft) * weightX;
        output[outputOffset + channel] = Math.round(topValue + (bottomValue - topValue) * weightY);
      }
    }
  }

  return {
    input: await sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    left,
    top,
    z: slot.z,
  };
}

async function renderPsdMainBoard(
  slides: PreparedSlide[],
  aspectClass: "16:9" | "4:3",
) {
  const slots = TEMPLATE_MAIN_SLOTS[aspectClass].slice(0, slides.length);
  const placements = await Promise.all(slides.map((slide, index) => (
    perspectivePlacement(slide, slots[index])
  )));
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
  const capacity = [aspectClass === "4:3" ? 4 : 5, 3, 3, 3];
  const counts = [0, 0, 0, 0];
  const initiallyFilledBoards = Math.min(slideCount, counts.length);
  for (let board = 0; board < initiallyFilledBoards; board += 1) counts[board] = 1;

  let remaining = slideCount - initiallyFilledBoards;
  while (remaining > 0 && counts[0] < capacity[0]) {
    counts[0] += 1;
    remaining -= 1;
  }
  let cursor = 1;
  while (remaining > 0) {
    const board = 1 + ((cursor - 1) % (counts.length - 1));
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

/**
 * Fills the approved 16:9 slots like reusable smart objects.
 *
 * A board never receives the same slide twice. Across boards we walk one
 * continuous ring, so every selected slide is used before the least-used
 * slides are reused. This keeps the 7/7/4/9 approved layouts full whenever
 * possible without hiding which source slide was placed in each slot.
 */
function approved16x9SlidesAcrossBoards(slides: PreparedSlide[]) {
  let cursor = 0;
  return APPROVED_16X9_BODY_TEMPLATE_LIST.map((template) => {
    const capacity = resolveApprovedMockupSlots(template).length;
    const count = Math.min(capacity, slides.length);
    const group = Array.from({ length: count }, () => {
      const slide = slides[cursor % slides.length];
      cursor += 1;
      return slide;
    });
    return group;
  });
}

async function renderBoard(
  slides: PreparedSlide[],
  boardIndex: number,
  aspectClass: SupportedShortMockupAspectClass,
): Promise<ShortMockupBoard> {
  if (aspectClass === "16:9") {
    const template = APPROVED_16X9_BODY_TEMPLATE_LIST[boardIndex];
    if (!template) throw new Error(`승인된 16:9 본문 목업 ${boardIndex + 1}번을 찾지 못했습니다.`);
    const rendered = await renderApproved16x9Mockup({
      template,
      slides: slides.map((slide) => ({ index: slide.index, buffer: slide.buffer })),
    });
    return {
      kind: "body_image",
      name: BOARD_NAMES[boardIndex],
      bytes: rendered.bytes,
      caption: BOARD_CAPTIONS[boardIndex],
      slideIndexes: rendered.slotAssignments.map((assignment) => assignment.sourceSlideIndex),
      slideAspectRatio: median(slides.map((slide) => slide.aspectRatio)),
      width: rendered.width,
      height: rendered.height,
      mockupTemplateId: rendered.templateId,
      mockupTemplateVersion: rendered.templateVersion,
      slotAssignments: rendered.slotAssignments.map((assignment) => ({
        slotId: assignment.slotId,
        slideIndex: assignment.sourceSlideIndex,
      })),
    };
  }
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
      mockupTemplateId: `legacy-${aspectClass}-${BOARD_NAMES[boardIndex]}`,
      mockupTemplateVersion: APPROVED_16X9_TEMPLATE_VERSION,
      slotAssignments: slides.map((slide, index) => ({
        slotId: `legacy-slot-${index + 1}`,
        slideIndex: slide.index,
      })),
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
    mockupTemplateId: `legacy-${aspectClass}-${BOARD_NAMES[boardIndex]}`,
    mockupTemplateVersion: APPROVED_16X9_TEMPLATE_VERSION,
    slotAssignments: slides.map((slide, index) => ({
      slotId: `legacy-slot-${index + 1}`,
      slideIndex: slide.index,
    })),
  };
}

/**
 * Renders the four blog boards used for short (5-19 slide) portfolio decks.
 *
 * The input buffers must already have confidential text and images blurred.
 * This module intentionally has no Photoshop runtime dependency. The supplied
 * The approved 16:9 suite locks coordinates, angles, shadows, logo and layer
 * order while swapping only slide buffers. The existing 4:3 and A4 layouts stay
 * unchanged. Every slide is resized with `contain`, so its contents are never
 * stretched or cropped.
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
  const groups = input.aspectClass === "16:9"
    ? approved16x9SlidesAcrossBoards(prepared)
    : splitSlidesAcrossBoards(prepared, input.aspectClass);
  const boards: ShortMockupBoard[] = [];
  for (const [boardIndex, group] of groups.entries()) {
    boards.push(await renderBoard(group, boardIndex, input.aspectClass));
  }
  return {
    mode: "short_psd",
    aspectClass: input.aspectClass,
    selectedSlideIndexes: prepared.map((slide) => slide.index),
    selectedSlideCount: prepared.length,
    bodyBoardCount: 4,
    boards,
  };
}
