import sharp from "sharp";
import path from "node:path";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { contentAdmin } from "@/lib/content-ops/data";
import type { PortfolioVisualReview, SensitiveRegion } from "./visual-review";
import {
  classifySlideAspect,
  buildSixGridGroups,
  portfolioMockupMode,
  selectPortfolioSlides,
  shortMockupRankedIndexes,
  type SlideAspect,
} from "./slide-selection";
import {
  renderShortDocumentMockups,
  type SupportedShortMockupAspectClass,
} from "./short-mockup";
import { multiPageGridDimensions } from "./grid-layout";
import {
  findDuplicatePortfolioImage,
  fingerprintPortfolioImage,
} from "./image-fingerprint";
import {
  isPortfolioSlideRedactionProofForManifest,
  localRedactionRegions,
  type PortfolioSlideRedactionProof,
} from "./redaction-proof";
import {
  automaticDesignEligibleSlideIndexes,
  type LocalRedactionManifest,
} from "../pc-worker/redaction-manifest";
import { normalizeCoverTitle, suggestCoverTitles } from "./cover-title";
import { coverSlideBlockedMessage, resolveCoverSlide } from "./cover-slide";
import { excludePhotoHeavySlides } from "./photo-heavy";
import {
  classifyImageRegion,
  imageRegionStats,
  photoDetectionEnabled,
} from "./photo-detect";

type SharpOverlayOptions = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

type LoadedSlide = {
  index: number;
  buffer: Buffer;
  aspectRatio: number;
  contentHash: string;
  visualHash: string;
  redactionProof: PortfolioSlideRedactionProof;
};

export type GeneratedPortfolioAsset = {
  kind: "thumbnail" | "body_image";
  bucket: string;
  path: string;
  url: string;
  caption: string;
  slideIndexes: number[];
  slideAspectRatio: number;
  mockupMode?: "short_psd" | "six_grid";
  aspectClass?: SlideAspect | "mixed";
};

export const PORTFOLIO_REDACTION_SELECTION_ERROR_CODE = "PORTFOLIO_REDACTION_SELECTION_BLOCKED";

export class PortfolioRedactionSelectionBlocked extends Error {
  readonly code = PORTFOLIO_REDACTION_SELECTION_ERROR_CODE;

  constructor(message = "안전한 선택 블러 장표가 부족해 자동 디자인을 보류했습니다.") {
    super(`${PORTFOLIO_REDACTION_SELECTION_ERROR_CODE}: ${message}`);
    this.name = "PortfolioRedactionSelectionBlocked";
  }
}

const CANVAS = { width: 1600, height: 1000 };
const thumbnailTitleFontPath = path.join(process.cwd(), "public", "fonts", "Paperlogy-7Bold.ttf");
const thumbnailTemplatePath = path.join(
  process.cwd(),
  "public",
  "images",
  "content-ops",
  "portfolio-thumbnail-template.png",
);

function assetUrl(bucket: string, path: string) {
  return `/api/admin/assets?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

function clampRegion(region: SensitiveRegion, width: number, height: number) {
  // PowerPoint text regions are already glyph-line bounds. A compact safety
  // margin keeps the text unreadable without washing out the surrounding card,
  // diagram, or table cell.
  const padding = Math.max(5, Math.round(Math.min(width, height) * 0.005));
  const left = Math.max(0, Math.floor(region.x * width) - padding);
  const top = Math.max(0, Math.floor(region.y * height) - padding);
  const regionWidth = Math.min(width - left, Math.ceil(region.width * width) + padding * 2);
  const regionHeight = Math.min(height - top, Math.ceil(region.height * height) + padding * 2);
  if (regionWidth < 8 || regionHeight < 8) return null;
  return { left, top, width: regionWidth, height: regionHeight };
}

/**
 * 그림 하나가 실제 사진인지 캐릭터·아이콘인지 봅니다.
 *
 * 캐릭터와 아이콘은 포트폴리오에서 보여 줘야 할 결과물입니다.
 * 실제 사진에는 사람과 현장이 그대로 담기므로 가립니다.
 */
async function looksLikePhotograph(
  slideBuffer: Buffer,
  box: { left: number; top: number; width: number; height: number },
  slideArea: number,
) {
  const sample = 64;
  try {
    const raw = await sharp(slideBuffer)
      .extract(box)
      .flatten({ background: "#ffffff" })
      // 이웃끼리 색을 섞으면 일러스트의 평평한 면이 사라집니다.
      .resize(sample, sample, { fit: "fill", kernel: "nearest" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const stats = imageRegionStats(raw, sample, (box.width * box.height) / slideArea);
    return classifyImageRegion(stats).kind === "photograph";
  } catch {
    // 픽셀을 못 읽으면 사진으로 보고 가립니다.
    return true;
  }
}

async function redact(buffer: Buffer, regions: SensitiveRegion[]) {
  const oriented = await sharp(buffer)
    .rotate()
    .resize({ width: 1400, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (!regions.length) return {
    sourceBuffer: oriented.data,
    buffer: oriented.data,
    appliedRegionCount: 0,
  };
  const slideArea = oriented.info.width * oriented.info.height;
  const keepIllustrations = photoDetectionEnabled();
  const boxes: NonNullable<ReturnType<typeof clampRegion>>[] = [];
  for (const region of regions) {
    const box = clampRegion(region, oriented.info.width, oriented.info.height);
    if (!box) continue;
    if (keepIllustrations && region.type === "embedded_photo") {
      if (!await looksLikePhotograph(oriented.data, box, slideArea)) continue;
    }
    boxes.push(box);
  }
  if (!boxes.length) return {
    sourceBuffer: oriented.data,
    buffer: oriented.data,
    appliedRegionCount: 0,
  };
  const blurred = await sharp(oriented.data)
    .blur(24)
    .modulate({ brightness: 0.98, saturation: 0.72 })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${oriented.info.width}" height="${oriented.info.height}" xmlns="http://www.w3.org/2000/svg">`
    + boxes.map((box) => (
      `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="4" fill="#fff"/>`
    )).join("")
    + "</svg>",
  );
  const maskedBlur = await sharp(blurred)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  return {
    sourceBuffer: oriented.data,
    buffer: await sharp(oriented.data)
      .composite([{ input: maskedBlur, left: 0, top: 0 }])
      .png()
      .toBuffer(),
    appliedRegionCount: boxes.length,
  };
}

async function changedPixelRatio(source: Buffer, redacted: Buffer) {
  const normalize = (input: Buffer) => sharp(input)
    .flatten({ background: "#ffffff" })
    .resize(640, 480, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const [before, after] = await Promise.all([normalize(source), normalize(redacted)]);
  const pixels = Math.floor(Math.min(before.length, after.length) / 3);
  if (!pixels) return 0;
  let changed = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 3;
    const difference = Math.abs(before[offset] - after[offset])
      + Math.abs(before[offset + 1] - after[offset + 1])
      + Math.abs(before[offset + 2] - after[offset + 2]);
    if (difference >= 9) changed += 1;
  }
  return changed / pixels;
}

async function loadSlides(input: {
  bucket: string;
  slidePaths: string[];
  indexes: number[];
  sensitiveRegions: SensitiveRegion[];
}) {
  const values: LoadedSlide[] = [];
  const loadOne = async (index: number): Promise<LoadedSlide | null> => {
    const path = input.slidePaths[index];
    if (!path) return null;
    const { data, error } = await contentAdmin().storage.from(input.bucket).download(path);
    if (error || !data) throw new Error(error?.message || `슬라이드 ${index + 1}을 읽지 못했습니다.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const { contentHash, visualHash } = await fingerprintPortfolioImage(bytes);
    const redacted = await redact(
      bytes,
      input.sensitiveRegions.filter((region) => region.slideIndex === index),
    );
    const buffer = redacted.buffer;
    const pixelChange = await changedPixelRatio(redacted.sourceBuffer, buffer);
    const metadata = await sharp(buffer).rotate().metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`슬라이드 ${index + 1}의 비율을 불러오지 못했습니다.`);
    }
    return {
      index,
      buffer,
      aspectRatio: metadata.width / metadata.height,
      contentHash,
      visualHash,
      redactionProof: {
        slideIndex: index,
        sourceHash: createHash("sha256").update(redacted.sourceBuffer).digest("hex"),
        redactedHash: createHash("sha256").update(buffer).digest("hex"),
        regionCount: redacted.appliedRegionCount,
        changedPixelRatio: pixelChange,
      },
    };
  };
  const concurrency = 3;
  for (let offset = 0; offset < input.indexes.length; offset += concurrency) {
    const batch = await Promise.all(input.indexes.slice(offset, offset + concurrency).map(loadOne));
    values.push(...batch.filter((slide): slide is LoadedSlide => Boolean(slide)));
    console.info(`[portfolio-mockup] loaded ${values.length}/${input.indexes.length} slide(s)`);
  }
  return values;
}

export function representativeSlideAspectRatio(slides: Pick<LoadedSlide, "aspectRatio">[]) {
  const ratios = slides
    .map((slide) => slide.aspectRatio)
    .filter((ratio) => Number.isFinite(ratio) && ratio >= 0.55 && ratio <= 2.2)
    .sort((a, b) => a - b);
  if (!ratios.length) return 16 / 9;
  const middle = Math.floor(ratios.length / 2);
  return ratios.length % 2
    ? ratios[middle]
    : (ratios[middle - 1] + ratios[middle]) / 2;
}

async function fittedSlide(buffer: Buffer, width: number, height: number) {
  return sharp(buffer)
    .rotate()
    .resize({ width, height, fit: "contain", background: "#ffffff", withoutEnlargement: false })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

function shadowSvg(width: number, height: number, radius = 22) {
  return Buffer.from(`<svg width="${width + 90}" height="${height + 90}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#28193a" flood-opacity=".24"/>
    </filter></defs>
    <rect x="45" y="22" width="${width}" height="${height}" rx="${radius}" fill="#ffffff" filter="url(#s)"/>
  </svg>`);
}

async function frame(
  buffer: Buffer,
  width: number,
  height: number,
  options: { angle?: number; radius?: number } = {},
) {
  const radius = options.radius ?? 18;
  const slide = await fittedSlide(buffer, width, height);
  const composed = await sharp({
    create: { width: width + 90, height: height + 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([
    { input: shadowSvg(width, height, radius), left: 0, top: 0 },
    { input: slide, left: 45, top: 22 },
  ]).png().toBuffer();
  return options.angle
    ? sharp(composed).rotate(options.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    : composed;
}

function galleryBackgroundSvg(width: number, height: number, variant: number) {
  const palettes = [
    ["#edf1ee", "#dce5df"],
    ["#edf0f4", "#d9e0e8"],
    ["#f1edeb", "#e4dcda"],
    ["#f0edf3", "#dfd9e8"],
    ["#eceeef", "#d9dddf"],
  ];
  const [start, end] = palettes[variant % palettes.length];
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${start}"/>
        <stop offset="1" stop-color="${end}"/>
      </linearGradient>
      <radialGradient id="r">
        <stop stop-color="#ffffff" stop-opacity=".72"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <ellipse cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.45)}" rx="${Math.round(width * 0.55)}" ry="${Math.round(height * 0.6)}" fill="url(#r)"/>
  </svg>`);
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] || character);
}

function inferredClientCategory(review: Pick<PortfolioVisualReview, "clientCategory" | "projectTitle" | "industry" | "designSummary" | "reasons">) {
  if (review.clientCategory && review.clientCategory !== "unknown") return review.clientCategory;
  const context = [
    review.projectTitle,
    review.industry,
    review.designSummary,
    ...(review.reasons || []),
  ].join(" ");
  if (/대기업|그룹사|글로벌 기업/.test(context)) return "large_company";
  if (/공공기관|정부기관|지자체|시청|군청|도청|교육청|공사|공단|공공 서비스/.test(context)) {
    return "public_institution";
  }
  return "general_company";
}

/**
 * 표지 문구를 만듭니다.
 *
 * 관리자가 골라 둔 문구가 있으면 그것을 그대로 씁니다.
 * 없을 때만 아래 규칙으로 만들며, 같은 낱말이 반복되면 후보 생성기가 걸러냅니다.
 */
export function privacySafeThumbnailTitle(
  review: PortfolioVisualReview,
  chosenTitle?: string | null,
) {
  const chosen = normalizeCoverTitle(chosenTitle);
  if (chosen) return chosen;
  const context = `${review.industry || ""} ${review.documentType || ""}`.toLowerCase();
  const category = inferredClientCategory(review);
  const prefix = category === "large_company"
    ? "대기업"
    : category === "public_institution"
      ? "공공기관"
      : "";
  const subject = /관광|여행/.test(context)
    ? "관광마케팅"
    : /연구|r&d|바이오|농축|스마트팜|기술개발/.test(context)
      ? "연구개발"
      : /인사|hr|노무|일터혁신/.test(context)
        ? "인사·HR"
        : /뷰티|화장품|미용/.test(context)
          ? "뷰티"
          : /반려|펫|동물/.test(context)
            ? "반려동물"
            : /무역|수출|해외/.test(context)
              ? "해외 무역"
              : /교육|학교/.test(context)
                ? "교육"
                : /경영|컨설팅/.test(context)
                  ? "경영컨설팅"
                  : "비즈니스";
  const documentType = /사업계획/.test(context)
    ? "사업계획서"
    : /회사소개|브랜드소개/.test(context)
      ? "회사소개서"
      : /제품소개/.test(context)
        ? "제품소개서"
        : /입찰/.test(context)
          ? "입찰제안서"
          : /제안/.test(context)
            ? "제안서"
            : /발표|프레젠테이션/.test(context)
              ? "발표자료"
              : /ir/.test(context)
                ? "IR 자료"
                : "비즈니스 문서";
  // 규칙으로 만든 문구가 "비즈니스 비즈니스 문서"처럼 겹치면 후보 생성기가 고른 값을 씁니다.
  return suggestCoverTitles({
    base: [prefix, subject, documentType, "디자인"].filter(Boolean).join(" "),
    parts: { clientPrefix: prefix, subject, documentType, projectName: review.projectTitle },
  })[0];
}

function thumbnailTitleLines(value: string) {
  const compact = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36)
    .replace(/\b3d\b/gi, "3D");
  if (!compact) return ["비즈니스 문서", "디자인 포트폴리오"];
  if (compact.length <= 16) return [compact];
  const words = compact.split(" ");
  if (words.length === 1) {
    const middle = Math.ceil(compact.length / 2);
    return [compact.slice(0, middle), compact.slice(middle)];
  }
  const target = compact.length / 2;
  let bestIndex = 1;
  let running = words[0].length;
  let bestDistance = Math.abs(running - target);
  for (let index = 1; index < words.length; index += 1) {
    running += 1 + words[index].length;
    const distance = Math.abs(running - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }
  return [words.slice(0, bestIndex).join(" "), words.slice(bestIndex).join(" ")]
    .filter(Boolean);
}

async function thumbnailTitle(text: string) {
  const lines = thumbnailTitleLines(text);
  const longestLine = Math.max(...lines.map((line) => line.length));
  const fontSize = longestLine <= 13 ? 80 : longestLine <= 16 ? 72 : 64;
  const width = 760;
  const height = 160;
  const textImage = await sharp({
    text: {
      text: `<span foreground="#ffffff" font_desc="Paperlogy Bold ${fontSize}">${escapeXml(lines.join("\n"))}</span>`,
      font: "Paperlogy",
      fontfile: thumbnailTitleFontPath,
      width,
      height,
      spacing: Math.max(30, Math.round(fontSize * 0.475)),
      align: "center",
      rgba: true,
    },
  }).png().toBuffer();
  const gradient = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#f15b24"/>
      <stop offset=".7" stop-color="#f36b2a"/>
      <stop offset="1" stop-color="#ffb27d"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`);
  return {
    buffer: await sharp(gradient)
      .composite([{ input: textImage, blend: "dest-in" }])
      .png()
      .toBuffer(),
    top: lines.length === 1 ? 368 : 328,
  };
}

async function thumbnailCover(slide: LoadedSlide) {
  const width = 778;
  const height = 439;
  const fitted = await fittedSlide(slide.buffer, width, height);
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" rx="7" fill="#ffffff"/>
  </svg>`);
  return sharp(fitted)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function thumbnail(slide: LoadedSlide, title: string) {
  try {
    await Promise.all([access(thumbnailTemplatePath), access(thumbnailTitleFontPath)]);
  } catch {
    throw new Error("PSD 썸네일 템플릿 또는 Paperlogy-7Bold 글꼴을 찾지 못했습니다.");
  }
  const [cover, heading] = await Promise.all([
    thumbnailCover(slide),
    thumbnailTitle(title),
  ]);
  return sharp(thumbnailTemplatePath)
    .composite([
      { input: heading.buffer, left: 160, top: heading.top },
      { input: cover, left: 154, top: 517 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

function assertVisuallyUniqueSlides(slides: LoadedSlide[]) {
  const duplicate = findDuplicatePortfolioImage(slides);
  if (!duplicate) return;
  throw new Error(`같은 장표 이미지가 ${slides[duplicate.duplicatePosition].index + 1}번과 ${slides[duplicate.position].index + 1}번에 중복되어 목업 제작을 중단했습니다.`);
}

async function multiPageBoard(slides: LoadedSlide[], variant: number) {
  const selected = slides.slice(0, 6);
  const dimensions = multiPageGridDimensions(
    selected.length,
    representativeSlideAspectRatio(selected),
  );
  const { columns, cardWidth, cardHeight } = dimensions;
  const frames = await Promise.all(selected.map((slide) =>
    frame(slide.buffer, cardWidth, cardHeight, { radius: 10 })));
  const frameWidth = cardWidth + 90;
  const frameHeight = cardHeight + 90;
  const rowCounts = Array.from({ length: Math.ceil(selected.length / columns) }, (_, row) =>
    Math.min(columns, selected.length - row * columns));
  const placements: SharpOverlayOptions[] = [];
  const startY = Math.max(0, Math.round((CANVAS.height - rowCounts.length * frameHeight) / 2));
  let index = 0;
  rowCounts.forEach((rowCount, row) => {
    const rowWidth = rowCount * frameWidth;
    const startX = Math.round((CANVAS.width - rowWidth) / 2);
    for (let column = 0; column < rowCount; column += 1) {
      placements.push({
        input: frames[index],
        left: startX + column * frameWidth,
        top: startY + row * frameHeight,
      });
      index += 1;
    }
  });
  return sharp({ create: { ...CANVAS, channels: 3, background: "#26173d" } })
    .composite([
      { input: galleryBackgroundSvg(CANVAS.width, CANVAS.height, variant), left: 0, top: 0 },
      ...placements,
    ])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

export function portfolioMockupIndexes(
  slideCount: number,
  review?: PortfolioVisualReview,
  localManifest?: LocalRedactionManifest,
) {
  const eligibleSlideIndexes = localManifest
    ? automaticDesignEligibleSlideIndexes(localManifest)
    : Array.from({ length: slideCount }, (_, index) => index);
  const mode = localManifest
    ? portfolioMockupMode(localManifest.sourceSlideCount)
    : portfolioMockupMode(slideCount);
  /**
   * 보여 줄 것이 적은 장표를 선정에서 뺍니다.
   *
   * 사진으로 뒤덮인 장표는 가리고 나면 남는 것이 없고,
   * 표 하나로 꽉 찬 장표는 자료 목록에 가까워 디자인을 보여 주지 못합니다.
   * 목업에 필요한 최소 장수를 못 채우게 되면 덜 심한 것부터 되살립니다.
   */
  const usable = localManifest
    ? excludePhotoHeavySlides({
      slides: localManifest.slides,
      eligibleSlideIndexes,
      minimumKept: mode === "long" ? 18 : 5,
    })
    : { keptSlideIndexes: eligibleSlideIndexes, excludedSlideIndexes: [] };
  /**
   * 표지는 사진 제외 규칙보다 먼저 확보합니다.
   *
   * 표지는 장표 전체가 사진인 경우가 흔합니다. 사진 제외 규칙을 먼저 걸면
   * 표지가 통째로 빠져 엉뚱한 장표가 대표 썸네일이 됩니다. 실제로 그렇게 됐습니다.
   * 그래서 가림 검사만 통과했으면 표지는 사진이든 아니든 그대로 씁니다.
   */
  const cover = resolveCoverSlide({
    slides: localManifest?.slides,
    eligibleSlideIndexes,
  });
  const coverIndex = cover.coverIndex;
  const eligible = new Set(usable.keptSlideIndexes);
  if (coverIndex !== undefined) eligible.add(coverIndex);
  const chooseSlides = (pool: number[]) => selectPortfolioSlides({
    slideCount,
    assessments: review?.slideAssessments || [],
    eligibleSlideIndexes: pool,
    modeOverride: mode === "insufficient" ? undefined : mode,
  });
  const keepInRange = (indexes: number[], pool: Set<number>) => indexes
    .filter((index) => index >= 0 && index < slideCount && pool.has(index));

  /** 목업을 만들려면 이만큼은 골라야 합니다. 못 채우면 작업이 보류됩니다. */
  const minimumSelected = mode === "long" ? 18 : 5;
  let selection = localManifest
    ? chooseSlides(usable.keptSlideIndexes)
    : review?.selection || selectPortfolioSlides({
      slideCount,
      assessments: review?.slideAssessments || [],
    });
  let selectedIndexes = keepInRange(selection.selectedSlideIndexes, eligible);
  let lowValueSlideIndexes: number[] = usable.excludedSlideIndexes;

  /**
   * 사진·표 장표를 뺐더니 고를 것이 모자라면 뺀 것을 다시 넣고 고릅니다.
   *
   * 선정 단계는 비슷한 화면을 다시 걸러 내므로, 남긴 장수보다 결과가 적습니다.
   * 그래서 뺄 때 최소 장수만 맞춰 두면 선정에서 그 아래로 내려가 작업이 멈춥니다.
   * 실제로 43장짜리 제안서가 12장만 골라져 보류됐습니다.
   * 보기 좋은 장표를 고르는 것보다 목업이 나오는 것이 먼저입니다.
   */
  if (localManifest && selectedIndexes.length < minimumSelected
    && usable.excludedSlideIndexes.length) {
    const wholePool = new Set(eligibleSlideIndexes);
    if (coverIndex !== undefined) wholePool.add(coverIndex);
    const retry = chooseSlides(eligibleSlideIndexes);
    const retryIndexes = keepInRange(retry.selectedSlideIndexes, wholePool);
    if (retryIndexes.length > selectedIndexes.length) {
      selection = retry;
      selectedIndexes = retryIndexes;
      lowValueSlideIndexes = [];
      for (const index of retryIndexes) eligible.add(index);
    }
  }
  const groups = mode === "long" ? buildSixGridGroups(selectedIndexes) : [];
  const indexes = [...new Set([
    ...(coverIndex === undefined ? [] : [coverIndex]),
    ...selectedIndexes,
  ])];
  return {
    mode,
    groups,
    indexes,
    selectedIndexes,
    selection,
    coverIndex,
    coverBlockedReason: cover.blockedReason,
    // 사진·표로 뒤덮여 뺀 장표. 화면에서 몇 장이 빠졌는지 알려 주는 데 씁니다.
    // 표지는 다시 살렸으므로 뺀 장표로 세지 않습니다.
    lowValueSlideIndexes: lowValueSlideIndexes.filter((index) => index !== coverIndex),
    coverSubstitutedSourceSlideNumber: cover.substitutedSourceSlideNumber,
    eligibleSlideIndexes,
    blockedSlideIndexes: localManifest
      ? localManifest.slides
        .map((slide) => slide.slideIndex)
        .filter((index) => !eligible.has(index))
      : [],
  };
}

function aggregateAspectClass(slides: LoadedSlide[]) {
  const classes = slides.map((slide) => classifySlideAspect(slide.aspectRatio));
  const supported = classes.filter((value): value is SupportedShortMockupAspectClass => value !== "unknown");
  if (!supported.length) return { aspectClass: "unknown" as const, primary: null };
  const counts = new Map<SupportedShortMockupAspectClass, number>();
  supported.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const primary = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  const distinct = new Set(classes);
  return {
    aspectClass: distinct.size > 1 ? "mixed" as const : primary,
    primary,
  };
}

async function uploadAsset(bucket: string, path: string, bytes: Buffer) {
  const { error } = await contentAdmin().storage.from(bucket).upload(path, bytes, {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

export async function createPortfolioMockups(input: {
  candidateId: string;
  bucket: string;
  slidePaths: string[];
  review: PortfolioVisualReview;
  localRedactionManifest: LocalRedactionManifest;
  /** 관리자가 골라 둔 표지 문구. 있으면 그대로 씁니다. */
  coverTitle?: string | null;
  onRedactionProof?: (proof: PortfolioSlideRedactionProof[]) => Promise<void> | void;
}) {
  console.info(`[portfolio-mockup] starting candidate=${input.candidateId} slides=${input.slidePaths.length}`);
  const plan = portfolioMockupIndexes(
    input.slidePaths.length,
    input.review,
    input.localRedactionManifest,
  );
  if (plan.mode === "insufficient") {
    throw new Error("포트폴리오 목업은 최소 5장인 문서에서 만들 수 있습니다.");
  }
  const minimumSelectedSlides = plan.mode === "long" ? 18 : 5;
  if (plan.selectedIndexes.length < minimumSelectedSlides || plan.indexes.length < 1) {
    throw new PortfolioRedactionSelectionBlocked(
      `사용 가능한 장표 ${plan.selectedIndexes.length}개, 필요 장표 ${minimumSelectedSlides}개`,
    );
  }
  const manifestSlides = new Map(input.localRedactionManifest.slides.map((slide) => [
    slide.slideIndex,
    slide,
  ]));
  const slides = await loadSlides({
    bucket: input.bucket,
    slidePaths: input.slidePaths,
    indexes: plan.indexes,
    sensitiveRegions: localRedactionRegions(input.localRedactionManifest, plan.indexes),
  });
  console.info(`[portfolio-mockup] redacted and loaded ${slides.length} slide(s)`);
  if (slides.length < 5) throw new Error("다중 페이지 목업을 만들 장표가 5장 미만입니다.");
  const slideMap = new Map(slides.map((slide) => [slide.index, slide]));
  const selectedSlides = plan.selectedIndexes
    .map((index) => slideMap.get(index))
    .filter((slide): slide is LoadedSlide => Boolean(slide));
  if (selectedSlides.length < 5) {
    throw new Error("중복되지 않는 우수 장표가 5장 미만이라 목업 제작을 중단했습니다.");
  }
  const redactionProof = plan.indexes
    .map((index) => slideMap.get(index)?.redactionProof)
    .filter((proof): proof is PortfolioSlideRedactionProof => Boolean(proof));
  if (redactionProof.length !== plan.indexes.length
    || redactionProof.some((proof) => {
      const manifestSlide = manifestSlides.get(proof.slideIndex);
      return !manifestSlide
        || !isPortfolioSlideRedactionProofForManifest(proof, manifestSlide);
    })) {
    throw new Error("모든 선정 장표의 로컬 기밀 블러가 실제 이미지에 적용되었는지 확인하지 못했습니다.");
  }
  if (input.onRedactionProof) await input.onRedactionProof(redactionProof);
  console.info(`[portfolio-mockup] persisted redaction proof for ${redactionProof.length} slide(s)`);
  const groupSlides = plan.groups.map((group) => group
    .map((index) => slideMap.get(index))
    .filter((slide): slide is LoadedSlide => Boolean(slide)));
  if (plan.mode === "long" && (
    groupSlides.length < 3
    || groupSlides.length > 5
    || groupSlides.some((group) => group.length !== 6)
  )) {
    throw new Error("긴 문서 목업에 필요한 중복 없는 6장 묶음 3~5개를 완성하지 못했습니다.");
  }
  const thumbnailSlide = plan.coverIndex === undefined
    ? undefined
    : slideMap.get(plan.coverIndex);
  if (!thumbnailSlide) {
    throw new Error(coverSlideBlockedMessage(plan.coverBlockedReason || "redaction_excluded"));
  }
  const aspect = aggregateAspectClass(selectedSlides);
  const rankedShortSlides = plan.mode === "short"
    ? shortMockupRankedIndexes(plan.selection, aspect.primary === "4:3" ? 13 : 14)
      .map((index) => slideMap.get(index))
      .filter((slide): slide is LoadedSlide => Boolean(slide))
    : selectedSlides;
  assertVisuallyUniqueSlides(plan.mode === "short" ? rankedShortSlides : selectedSlides);
  const captions = [
    "문서 도입부의 구성과 첫인상을 한눈에 보여주는 다중 페이지 목업",
    "초반부 정보 구조와 레이아웃의 반복 원칙을 비교하는 다중 페이지 목업",
    "문서 중반부의 콘텐츠 전개와 시각적 변주를 보여주는 다중 페이지 목업",
    "핵심 전략과 실행 내용을 여러 페이지 흐름으로 보여주는 다중 페이지 목업",
    "문서 후반부까지 이어지는 디자인 일관성을 확인하는 다중 페이지 목업",
  ];

  const bodyOutputs = plan.mode === "short"
    ? await (async () => {
      if (!aspect.primary) {
        throw new Error("PPT 규격을 16:9, 4:3, A4 가로, A4 세로 중 하나로 판별하지 못했습니다.");
      }
      const result = await renderShortDocumentMockups({
        deckSlideCount: input.slidePaths.length,
        aspectClass: aspect.primary,
        slides: rankedShortSlides.map((slide) => ({ index: slide.index, buffer: slide.buffer })),
      });
      return result.boards.map((board) => ({
        ...board,
        mockupMode: "short_psd" as const,
        aspectClass: aspect.aspectClass,
      }));
    })()
    : await Promise.all(groupSlides.map(async (group, index) => ({
      kind: "body_image" as const,
      name: `multi-page-${index + 1}.jpg`,
      bytes: await multiPageBoard(group, index),
      caption: captions[index],
      slideIndexes: group.map((slide) => slide.index),
      slideAspectRatio: representativeSlideAspectRatio(group),
      mockupMode: "six_grid" as const,
      aspectClass: aspect.aspectClass,
    })));
  console.info(`[portfolio-mockup] rendered ${bodyOutputs.length} body board(s)`);
  const outputs = [
    {
      kind: "thumbnail" as const,
      name: "thumbnail.jpg",
      bytes: await thumbnail(
        thumbnailSlide,
        privacySafeThumbnailTitle(input.review, input.coverTitle),
      ),
      caption: "문서의 여러 구간을 한 화면에 보여주는 포트폴리오 대표 이미지",
      slideIndexes: [thumbnailSlide.index],
      slideAspectRatio: thumbnailSlide.aspectRatio,
      mockupMode: plan.mode === "short" ? "short_psd" as const : "six_grid" as const,
      aspectClass: aspect.aspectClass,
    },
    ...bodyOutputs,
  ];

  const base = `${input.candidateId}/mockups/${crypto.randomUUID()}`;
  const assets: GeneratedPortfolioAsset[] = [];
  for (const output of outputs) {
    const path = `${base}/${output.name}`;
    await uploadAsset(input.bucket, path, output.bytes);
    console.info(`[portfolio-mockup] uploaded ${output.name}`);
    assets.push({
      kind: output.kind,
      bucket: input.bucket,
      path,
      url: assetUrl(input.bucket, path),
      caption: output.caption,
      slideIndexes: output.slideIndexes,
      slideAspectRatio: output.slideAspectRatio,
      mockupMode: output.mockupMode,
      aspectClass: output.aspectClass,
    });
  }
  return assets;
}
