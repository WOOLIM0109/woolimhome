import sharp from "sharp";
import path from "node:path";
import { access } from "node:fs/promises";
import { contentAdmin } from "@/lib/content-ops/data";
import type { PortfolioVisualReview, SensitiveRegion } from "./visual-review";

type SharpOverlayOptions = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

type LoadedSlide = {
  index: number;
  buffer: Buffer;
  aspectRatio: number;
};

export type GeneratedPortfolioAsset = {
  kind: "thumbnail" | "body_image";
  bucket: string;
  path: string;
  url: string;
  caption: string;
  slideIndexes: number[];
  slideAspectRatio: number;
};

const CANVAS = { width: 1600, height: 1000 };
const thumbnailTitleFontPath = path.join(process.cwd(), "public", "fonts", "Paperlogy-8ExtraBold.ttf");
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
  const left = Math.max(0, Math.floor(region.x * width) - 8);
  const top = Math.max(0, Math.floor(region.y * height) - 8);
  const regionWidth = Math.min(width - left, Math.ceil(region.width * width) + 16);
  const regionHeight = Math.min(height - top, Math.ceil(region.height * height) + 16);
  if (regionWidth < 8 || regionHeight < 8) return null;
  return { left, top, width: regionWidth, height: regionHeight };
}

async function redact(buffer: Buffer, regions: SensitiveRegion[]) {
  if (!regions.length) return buffer;
  const oriented = await sharp(buffer).rotate().png().toBuffer({ resolveWithObject: true });
  const composites: SharpOverlayOptions[] = [];
  for (const region of regions) {
    const box = clampRegion(region, oriented.info.width, oriented.info.height);
    if (!box) continue;
    const blurStrength = region.type === "body_text" ? 18 : region.type === "footer" ? 20 : 24;
    const blurred = await sharp(oriented.data)
      .extract(box)
      .blur(blurStrength)
      .modulate({
        brightness: region.type === "embedded_photo" ? 0.98 : 0.96,
        saturation: region.type === "embedded_photo" ? 0.72 : 0.5,
      })
      .png()
      .toBuffer();
    composites.push({ input: blurred, left: box.left, top: box.top });
  }
  return composites.length
    ? sharp(oriented.data).composite(composites).png().toBuffer()
    : oriented.data;
}

async function loadSlides(input: {
  bucket: string;
  slidePaths: string[];
  indexes: number[];
  sensitiveRegions: SensitiveRegion[];
}) {
  const values: LoadedSlide[] = [];
  for (const index of input.indexes) {
    const path = input.slidePaths[index];
    if (!path) continue;
    const { data, error } = await contentAdmin().storage.from(input.bucket).download(path);
    if (error || !data) throw new Error(error?.message || `슬라이드 ${index + 1}을 읽지 못했습니다.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const buffer = await redact(
      bytes,
      input.sensitiveRegions.filter((region) => region.slideIndex === index),
    );
    const metadata = await sharp(buffer).rotate().metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`슬라이드 ${index + 1}의 비율을 불러오지 못했습니다.`);
    }
    values.push({
      index,
      buffer,
      aspectRatio: metadata.width / metadata.height,
    });
  }
  return values;
}

export function representativeSlideAspectRatio(slides: Pick<LoadedSlide, "aspectRatio">[]) {
  const ratios = slides
    .map((slide) => slide.aspectRatio)
    .filter((ratio) => Number.isFinite(ratio) && ratio >= 1.2 && ratio <= 2.2)
    .sort((a, b) => a - b);
  if (!ratios.length) return 16 / 9;
  const middle = Math.floor(ratios.length / 2);
  return ratios.length % 2
    ? ratios[middle]
    : (ratios[middle - 1] + ratios[middle]) / 2;
}

function slideFrameHeight(width: number, slides: LoadedSlide[]) {
  return Math.round(width / representativeSlideAspectRatio(slides));
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
      text: `<span foreground="#ffffff" font_desc="Paperlogy ExtraBold ${fontSize}">${escapeXml(lines.join("\n"))}</span>`,
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
    throw new Error("PSD 썸네일 템플릿 또는 Paperlogy-8ExtraBold 글꼴을 찾지 못했습니다.");
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

async function multiPageBoard(slides: LoadedSlide[], variant: number) {
  const selected = slides.slice(0, 6);
  const columns = selected.length <= 4 ? 2 : 3;
  const cardWidth = columns === 3 ? 430 : 620;
  const cardHeight = slideFrameHeight(cardWidth, selected);
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

function sectionGroups(length: number, groupCount = 5, groupSize = 6) {
  const size = Math.min(groupSize, length);
  const maxStart = Math.max(0, length - size);
  return Array.from({ length: groupCount }, (_, groupIndex) => {
    const start = groupCount === 1
      ? 0
      : Math.round((groupIndex * maxStart) / (groupCount - 1));
    return Array.from({ length: size }, (__, offset) => start + offset);
  });
}

export function portfolioMockupIndexes(slideCount: number) {
  const groups = sectionGroups(slideCount);
  const indexes = [...new Set([0, ...groups.flat()])]
    .filter((index) => index >= 0 && index < slideCount);
  return { groups, indexes };
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
  thumbnailTitle?: string;
  extraSensitiveRegions?: SensitiveRegion[];
}) {
  const { groups, indexes } = portfolioMockupIndexes(input.slidePaths.length);
  const slides = await loadSlides({
    bucket: input.bucket,
    slidePaths: input.slidePaths,
    indexes,
    sensitiveRegions: [...input.review.sensitiveRegions, ...(input.extraSensitiveRegions || [])],
  });
  if (slides.length < 4) throw new Error("다중 페이지 목업을 만들 슬라이드가 4장 미만입니다.");
  const slideMap = new Map(slides.map((slide) => [slide.index, slide]));
  const groupSlides = groups.map((group) => group
    .map((index) => slideMap.get(index))
    .filter((slide): slide is LoadedSlide => Boolean(slide)));
  const thumbnailSlide = slideMap.get(0) || groupSlides[0][0];
  if (!thumbnailSlide) throw new Error("대표 썸네일에 사용할 표지 장표가 없습니다.");
  const captions = [
    "문서 도입부의 구성과 첫인상을 한눈에 보여주는 다중 페이지 목업",
    "초반부 정보 구조와 레이아웃의 반복 원칙을 비교하는 다중 페이지 목업",
    "문서 중반부의 콘텐츠 전개와 시각적 변주를 보여주는 다중 페이지 목업",
    "핵심 전략과 실행 내용을 여러 페이지 흐름으로 보여주는 다중 페이지 목업",
    "문서 후반부까지 이어지는 디자인 일관성을 확인하는 다중 페이지 목업",
  ];

  const bodyOutputs = await Promise.all(groupSlides.map(async (group, index) => ({
    kind: "body_image" as const,
    name: `multi-page-${index + 1}.jpg`,
    bytes: await multiPageBoard(group, index),
    caption: captions[index],
    slideIndexes: group.map((slide) => slide.index),
    slideAspectRatio: representativeSlideAspectRatio(group),
  })));
  const outputs = [
    {
      kind: "thumbnail" as const,
      name: "thumbnail.jpg",
      bytes: await thumbnail(
        thumbnailSlide,
        input.thumbnailTitle || input.review.projectTitle || input.review.documentType,
      ),
      caption: "문서의 여러 구간을 한 화면에 보여주는 포트폴리오 대표 이미지",
      slideIndexes: [thumbnailSlide.index],
      slideAspectRatio: thumbnailSlide.aspectRatio,
    },
    ...bodyOutputs,
  ];

  const base = `${input.candidateId}/mockups/${crypto.randomUUID()}`;
  const assets: GeneratedPortfolioAsset[] = [];
  for (const output of outputs) {
    const path = `${base}/${output.name}`;
    await uploadAsset(input.bucket, path, output.bytes);
    assets.push({
      kind: output.kind,
      bucket: input.bucket,
      path,
      url: assetUrl(input.bucket, path),
      caption: output.caption,
      slideIndexes: output.slideIndexes,
      slideAspectRatio: output.slideAspectRatio,
    });
  }
  return assets;
}
