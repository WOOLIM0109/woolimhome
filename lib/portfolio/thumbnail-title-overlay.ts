import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";

/** Kept outside the frozen board renderer: BODY fingerprints never depend on it. */
export const THUMBNAIL_TITLE_OVERLAY_VERSION = "thumbnail-title-overlay-v1" as const;
export const THUMBNAIL_TITLE_MAX_MAIN_CHARACTERS = 40;
export const THUMBNAIL_TITLE_MAX_SUB_CHARACTERS = 60;
export type ThumbnailTitleAspectClass = "16:9" | "a4_landscape" | "a4_portrait";
export type ThumbnailTitleSpec = Readonly<{
  main: string;
  sub: string;
  showSub: boolean;
  style: "bold";
}>;

type Box = Readonly<{ left: number; top: number; width: number; height: number }>;
type TitleLine = Readonly<Box & {
  text: string;
  fontSize: number;
  font: "Paperlogy 8ExtraBold" | "Paperlogy 7Bold";
  color: string;
}>;
export type ThumbnailTitleLayout = Readonly<{
  schemaVersion: 1;
  version: typeof THUMBNAIL_TITLE_OVERLAY_VERSION;
  aspectClass: ThumbnailTitleAspectClass;
  style: "bold";
  baseCanvas: Readonly<{ width: 1080; height: 1080 }>;
  /** Broad comparison boundary, not permission to cover a slide. */
  titleRegion: Box;
  main: TitleLine;
  sub: TitleLine | null;
}>;
export type RenderedThumbnailTitleLayout = Readonly<ThumbnailTitleLayout & {
  scale: 0.5 | 1;
  outputCanvas: Readonly<{ width: number; height: number }>;
  renderedLines: readonly (TitleLine & { source: "main" | "sub" })[];
  outsideTitlePixelChanges: 0;
}>;

const TITLE_REGION: Box = { left: 155, top: 12, width: 845, height: 122 };
const FONTS = {
  main: { name: "Paperlogy 8ExtraBold", url: new URL("../../public/fonts/Paperlogy-8ExtraBold.ttf", import.meta.url) },
  sub: { name: "Paperlogy 7Bold", url: new URL("../../public/fonts/Paperlogy-7Bold.ttf", import.meta.url) },
} as const;

function failure(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function normalizeLine(value: unknown, field: "main" | "sub", maximum: number) {
  if (typeof value !== "string" || value.length > maximum * 4) {
    failure("MOCKUP_TITLE_INVALID", `${field === "main" ? "메인" : "보조"} 제목 형식 또는 길이를 확인해 주세요.`);
  }
  // Never silently delete newlines, bidi controls, joiners, emoji selectors or
  // unsupported spaces. NFC composes ordinary Korean input before glyph checks.
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\uFE00-\uFE0F]/u.test(value)
    || /[^\S ]/u.test(value)) {
    failure("MOCKUP_TITLE_INVALID_CHARACTER", "제목은 줄바꿈·제어문자 없이 한 줄로 입력해 주세요.");
  }
  const normalized = value.normalize("NFC").trim().replace(/ {2,}/g, " ");
  if (Array.from(normalized).length > maximum) {
    failure("MOCKUP_TITLE_TOO_LONG", `${field === "main" ? "메인" : "보조"} 제목은 ${maximum}자 이내로 입력해 주세요.`);
  }
  if (field === "main" && !normalized) failure("MOCKUP_TITLE_REQUIRED", "메인 제목을 입력해 주세요.");
  return normalized;
}

/** All four fields are explicit; old single-string titles are not auto-migrated. */
export function normalizeThumbnailTitleSpec(value: unknown): ThumbnailTitleSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    failure("MOCKUP_TITLE_INVALID", "썸네일 제목 입력 형식이 올바르지 않습니다.");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["main", "showSub", "style", "sub"])
    || typeof input.showSub !== "boolean" || input.style !== "bold") {
    failure("MOCKUP_TITLE_INVALID", "메인·보조 제목, 보조 제목 표시 여부와 승인된 스타일만 저장할 수 있습니다.");
  }
  return {
    main: normalizeLine(input.main, "main", THUMBNAIL_TITLE_MAX_MAIN_CHARACTERS),
    sub: normalizeLine(input.sub, "sub", THUMBNAIL_TITLE_MAX_SUB_CHARACTERS),
    showSub: input.showSub,
    style: "bold",
  };
}

function assertAspectClass(aspectClass: unknown): asserts aspectClass is ThumbnailTitleAspectClass {
  if (!["16:9", "a4_landscape", "a4_portrait"].includes(String(aspectClass))) {
    failure("MOCKUP_TITLE_ASPECT_UNSUPPORTED", "제목 편집을 지원하지 않는 목업 규격입니다.");
  }
}

/** Reject missing-glyph substitutions using the bundled font, not a system fallback.
 * OpenType cmap mapping: https://learn.microsoft.com/en-us/typography/opentype/spec/cmap
 */
function fontGlyphLookup(bytes: Buffer): (codePoint: number) => number {
  function need(offset: number, length: number, end = bytes.length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > end) {
      failure("MOCKUP_TITLE_FONT_INVALID", "제목 폰트 데이터 검증에 실패했습니다.");
    }
  }
  need(0, 12);
  const count = bytes.readUInt16BE(4);
  need(12, count * 16);
  let cmapStart = -1;
  let cmapEnd = -1;
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 16;
    if (bytes.toString("ascii", entry, entry + 4) !== "cmap") continue;
    cmapStart = bytes.readUInt32BE(entry + 8);
    const length = bytes.readUInt32BE(entry + 12);
    need(cmapStart, length);
    cmapEnd = cmapStart + length;
    break;
  }
  if (cmapStart < 0) failure("MOCKUP_TITLE_FONT_INVALID", "제목 폰트 문자표가 없습니다.");
  need(cmapStart, 4, cmapEnd);
  const tables = bytes.readUInt16BE(cmapStart + 2);
  need(cmapStart + 4, tables * 8, cmapEnd);
  const candidates: { start: number; format: number; priority: number }[] = [];
  for (let i = 0; i < tables; i += 1) {
    const entry = cmapStart + 4 + i * 8;
    const platform = bytes.readUInt16BE(entry);
    const encoding = bytes.readUInt16BE(entry + 2);
    if (!(platform === 0 || (platform === 3 && [1, 10].includes(encoding)))) continue;
    const start = cmapStart + bytes.readUInt32BE(entry + 4);
    need(start, 2, cmapEnd);
    const format = bytes.readUInt16BE(start);
    if (format === 12 || format === 4) {
      candidates.push({ start, format, priority: (format === 12 ? 10 : 0) + (platform === 3 ? 1 : 0) });
    }
  }
  const selected = candidates.sort((a, b) => b.priority - a.priority)[0];
  if (!selected) failure("MOCKUP_TITLE_FONT_INVALID", "지원하는 제목 폰트 문자표가 없습니다.");
  const start = selected.start;
  if (selected.format === 12) {
    need(start, 16, cmapEnd);
    const length = bytes.readUInt32BE(start + 4);
    need(start, length, cmapEnd);
    const groups = bytes.readUInt32BE(start + 12);
    need(start + 16, groups * 12, start + length);
    return (codePoint) => {
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const entry = start + 16 + mid * 12;
        const first = bytes.readUInt32BE(entry);
        const last = bytes.readUInt32BE(entry + 4);
        if (codePoint < first) high = mid - 1;
        else if (codePoint > last) low = mid + 1;
        else return bytes.readUInt32BE(entry + 8) + codePoint - first;
      }
      return 0;
    };
  }
  need(start, 14, cmapEnd);
  const length = bytes.readUInt16BE(start + 2);
  need(start, length, cmapEnd);
  const segments = bytes.readUInt16BE(start + 6) / 2;
  if (!Number.isInteger(segments) || !segments) failure("MOCKUP_TITLE_FONT_INVALID", "제목 폰트 문자표가 올바르지 않습니다.");
  need(start + 14, segments * 8 + 2, start + length);
  const endCodes = start + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2;
  const offsets = deltas + segments * 2;
  return (codePoint) => {
    if (codePoint > 0xFFFF) return 0;
    for (let i = 0; i < segments; i += 1) {
      if (codePoint > bytes.readUInt16BE(endCodes + i * 2)) continue;
      const first = bytes.readUInt16BE(startCodes + i * 2);
      if (codePoint < first) return 0;
      const delta = bytes.readInt16BE(deltas + i * 2);
      const range = bytes.readUInt16BE(offsets + i * 2);
      if (!range) return (codePoint + delta) & 0xFFFF;
      const glyphAddress = offsets + i * 2 + range + (codePoint - first) * 2;
      need(glyphAddress, 2, start + length);
      const glyph = bytes.readUInt16BE(glyphAddress);
      return glyph ? (glyph + delta) & 0xFFFF : 0;
    }
    return 0;
  };
}

async function assertSupportedGlyphs(title: ThumbnailTitleSpec) {
  for (const field of ["main", "sub"] as const) {
    // Hidden text is also checked now, so unhiding cannot unexpectedly break it.
    const glyph = fontGlyphLookup(await readFile(FONTS[field].url));
    for (const character of title[field]) {
      const codePoint = character.codePointAt(0)!;
      if (!glyph(codePoint)) {
        failure("MOCKUP_TITLE_UNSUPPORTED_GLYPH", `${field === "main" ? "메인" : "보조"} 제목에 지원하지 않는 문자(U+${codePoint.toString(16).toUpperCase()})가 있습니다. 해당 문자나 이모지를 바꿔 주세요.`);
      }
    }
  }
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Do not enlarge this boundary by moving cards. It stays above the frozen top rail. */
function fitsAboveSlides(line: Box, aspect: ThumbnailTitleAspectClass) {
  const right = line.left + line.width;
  const bottom = line.top + line.height;
  if (line.left < TITLE_REGION.left || line.top < TITLE_REGION.top
    || right > TITLE_REGION.left + TITLE_REGION.width
    || bottom > TITLE_REGION.top + TITLE_REGION.height) return false;
  if (aspect === "a4_portrait") return bottom <= 126;
  const rail = aspect === "16:9" ? { x: -150, y: 190, angle: -9 }
    : { x: -160, y: 215, angle: -8 };
  const railY = rail.y + (right - rail.x) * Math.tan(rail.angle * Math.PI / 180);
  return bottom <= railY - 8;
}

async function rasterLine(text: string, field: "main" | "sub", fontSize: number) {
  const font = FONTS[field];
  const color = field === "main" ? "#253038" : "#ef762d";
  const { data, info } = await sharp({ text: {
    text: `<span foreground="${color}">${escapeXml(text)}</span>`,
    font: `${font.name} ${fontSize}`,
    fontfile: fileURLToPath(font.url), dpi: 72, rgba: true, wrap: "none", spacing: 0,
  } }).png().toBuffer({ resolveWithObject: true });
  // All positions and measurements are computed once at 1080, never from draft text metrics.
  return {
    bytes: data,
    line: { text, fontSize, font: font.name, color,
      left: field === "main" ? 178 : 182,
      top: field === "main" ? 20 : 86,
      width: info.width, height: info.height } satisfies TitleLine,
  };
}

async function prepareLayout(value: unknown, aspectClass: ThumbnailTitleAspectClass) {
  assertAspectClass(aspectClass);
  const title = normalizeThumbnailTitleSpec(value);
  await assertSupportedGlyphs(title);
  const sub = title.showSub && title.sub ? await rasterLine(title.sub, "sub", 22) : null;
  let main: Awaited<ReturnType<typeof rasterLine>> | null = null;
  // Limited typographic fitting only (54 → 44). Never squash, crop, wrap or ellipsize.
  for (const size of [54, 52, 50, 48, 46, 44]) {
    const candidate = await rasterLine(title.main, "main", size);
    const clearsSub = !sub || candidate.line.top + candidate.line.height + 8 <= sub.line.top;
    if (fitsAboveSlides(candidate.line, aspectClass) && clearsSub) { main = candidate; break; }
  }
  if (!main) failure("MOCKUP_TITLE_TOO_WIDE", "메인 제목이 제목 영역에 맞지 않습니다. 작업물 종류 중심으로 짧게 입력하거나 보조 제목을 숨겨 주세요.");
  if (sub && !fitsAboveSlides(sub.line, aspectClass)) {
    failure("MOCKUP_TITLE_TOO_WIDE", "보조 제목이 제목 영역보다 깁니다. 짧게 줄이거나 보조 제목을 숨겨 주세요.");
  }
  const layout: ThumbnailTitleLayout = {
    schemaVersion: 1, version: THUMBNAIL_TITLE_OVERLAY_VERSION,
    aspectClass, style: "bold", baseCanvas: { width: 1080, height: 1080 },
    titleRegion: { ...TITLE_REGION }, main: main.line, sub: sub?.line ?? null,
  };
  return { layout, main, sub };
}

/** Returns the exact full-size layout, or an actionable pre-save validation error. */
export async function validateThumbnailTitleLayout(title: ThumbnailTitleSpec, aspectClass: ThumbnailTitleAspectClass) {
  return (await prepareLayout(title, aspectClass)).layout;
}

export async function thumbnailTitleOverlayFingerprint() {
  const files = await Promise.all([new URL(import.meta.url), FONTS.main.url, FONTS.sub.url]
    .map(async (url) => createHash("sha256").update(await readFile(url)).digest("hex")));
  return createHash("sha256").update(JSON.stringify({
    version: THUMBNAIL_TITLE_OVERLAY_VERSION, files,
    sharpVersions: Object.fromEntries(Object.entries(sharp.versions).sort(([a], [b]) => a.localeCompare(b))),
  })).digest("hex");
}

/** basePng must be the freshly verified title-less board; never paint over old text. */
export async function renderThumbnailTitleOverlay(input: {
  basePng: Buffer;
  title: ThumbnailTitleSpec;
  aspectClass: ThumbnailTitleAspectClass;
  scale: 0.5 | 1;
}): Promise<{ bytes: Buffer; layout: RenderedThumbnailTitleLayout }> {
  if (input.scale !== 0.5 && input.scale !== 1) failure("MOCKUP_TITLE_SCALE_INVALID", "지원하지 않는 제목 렌더 배율입니다.");
  if (!Buffer.isBuffer(input.basePng) || input.basePng.length === 0
    || input.basePng.length > 32 * 1024 * 1024) failure("MOCKUP_TITLE_BASE_INVALID", "썸네일 기준 이미지가 올바르지 않습니다.");
  const dimension = 1080 * input.scale;
  const metadata = await sharp(input.basePng).metadata();
  if (metadata.format !== "png" || metadata.width !== dimension || metadata.height !== dimension
    || metadata.depth !== "uchar" || metadata.space !== "srgb" || metadata.hasProfile
    || (metadata.pages ?? 1) !== 1 || ![3, 4].includes(metadata.channels)
    || (metadata.orientation ?? 1) !== 1) {
    failure("MOCKUP_TITLE_BASE_INVALID", "제목 없는 검증된 정방형 PNG가 필요합니다.");
  }
  const { layout, main, sub } = await prepareLayout(input.title, input.aspectClass);
  const composites: OverlayOptions[] = [];
  const renderedLines: (TitleLine & { source: "main" | "sub" })[] = [];
  for (const [source, layer] of [["main", main], ["sub", sub]] as const) {
    if (!layer) continue;
    const scaled: TitleLine & { source: "main" | "sub" } = {
      ...layer.line, source, fontSize: layer.line.fontSize * input.scale,
      left: Math.round(layer.line.left * input.scale), top: Math.round(layer.line.top * input.scale),
      width: Math.round(layer.line.width * input.scale), height: Math.round(layer.line.height * input.scale),
    };
    const raster = input.scale === 1 ? layer.bytes
      : await sharp(layer.bytes).resize(scaled.width, scaled.height, { fit: "fill" }).png().toBuffer();
    composites.push({ input: raster, left: scaled.left, top: scaled.top });
    renderedLines.push(scaled);
  }
  const bytes = await sharp(input.basePng).composite(composites).png().toBuffer();
  const [before, after] = await Promise.all([input.basePng, bytes]
    .map((buffer) => sharp(buffer).ensureAlpha().raw().toBuffer()));
  for (let y = 0; y < dimension; y += 1) {
    for (let x = 0; x < dimension; x += 1) {
      const inText = renderedLines.some((line) => x >= line.left && x < line.left + line.width
        && y >= line.top && y < line.top + line.height);
      if (inText) continue;
      const offset = (y * dimension + x) * 4;
      if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1]
        || before[offset + 2] !== after[offset + 2] || before[offset + 3] !== after[offset + 3]) {
        failure("MOCKUP_TITLE_NON_TITLE_PIXELS_CHANGED", "제목 밖 이미지가 변경되어 새 썸네일을 확정하지 않았습니다.");
      }
    }
  }
  return { bytes, layout: { ...layout, scale: input.scale,
    outputCanvas: { width: dimension, height: dimension }, renderedLines, outsideTitlePixelChanges: 0 } };
}
