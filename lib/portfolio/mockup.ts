import sharp from "sharp";
import { contentAdmin } from "@/lib/content-ops/data";
import type { PortfolioVisualReview, SensitiveRegion } from "./visual-review";

type LoadedSlide = {
  index: number;
  buffer: Buffer;
};

export type GeneratedPortfolioAsset = {
  kind: "thumbnail" | "body_image";
  bucket: string;
  path: string;
  url: string;
  caption: string;
  slideIndexes: number[];
};

const CANVAS = { width: 1600, height: 1000 };

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
  const composites: sharp.OverlayOptions[] = [];
  for (const region of regions) {
    const box = clampRegion(region, oriented.info.width, oriented.info.height);
    if (!box) continue;
    const blurred = await sharp(oriented.data)
      .extract(box)
      .blur(22)
      .modulate({ brightness: 0.96, saturation: 0.5 })
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
    values.push({
      index,
      buffer: await redact(
        bytes,
        input.sensitiveRegions.filter((region) => region.slideIndex === index),
      ),
    });
  }
  return values;
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

function backgroundSvg(width: number, height: number, variant: number) {
  const palettes = [
    ["#24183a", "#74358f", "#f14d88"],
    ["#f5f0ec", "#d9d1e7", "#784392"],
    ["#eef1f7", "#cad6ee", "#264fa1"],
    ["#f4eef7", "#f8dce8", "#8b3c91"],
  ];
  const [a, b, c] = palettes[variant % palettes.length];
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".58" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>
      <radialGradient id="r"><stop stop-color="#ffffff" stop-opacity=".38"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.28)}" fill="url(#r)"/>
    <circle cx="${Math.round(width * 0.12)}" cy="${Math.round(height * 0.9)}" r="${Math.round(width * 0.2)}" fill="#ffffff" opacity=".1"/>
  </svg>`);
}

async function thumbnail(slides: LoadedSlide[]) {
  const width = 1080;
  const height = 1080;
  const main = await frame(slides[0].buffer, 820, 462, { angle: -4 });
  const supporting = slides[1]
    ? await frame(slides[1].buffer, 610, 343, { angle: 5 })
    : null;
  return sharp({ create: { width, height, channels: 3, background: "#24183a" } })
    .composite([
      { input: backgroundSvg(width, height, 0), left: 0, top: 0 },
      ...(supporting ? [{ input: supporting, left: 430, top: 95 }] : []),
      { input: main, left: 65, top: 345 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function heroCollage(slides: LoadedSlide[]) {
  const main = await frame(slides[0].buffer, 1080, 608);
  const left = await frame((slides[1] || slides[0]).buffer, 700, 394, { angle: -5 });
  const right = await frame((slides[2] || slides[0]).buffer, 700, 394, { angle: 5 });
  return sharp({ create: { ...CANVAS, channels: 3, background: "#ede8f1" } })
    .composite([
      { input: backgroundSvg(CANVAS.width, CANVAS.height, 1), left: 0, top: 0 },
      { input: left, left: -250, top: 310 },
      { input: right, left: 1040, top: 275 },
      { input: main, left: 215, top: 150 },
    ])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function singleStage(slide: LoadedSlide) {
  const main = await frame(slide.buffer, 1260, 709);
  return sharp({ create: { ...CANVAS, channels: 3, background: "#f4f0ec" } })
    .composite([
      { input: backgroundSvg(CANVAS.width, CANVAS.height, 2), left: 0, top: 0 },
      { input: main, left: 125, top: 120 },
    ])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function offsetPair(slides: LoadedSlide[]) {
  const back = await frame((slides[1] || slides[0]).buffer, 950, 534, { angle: -4 });
  const front = await frame(slides[0].buffer, 980, 551, { angle: 3 });
  return sharp({ create: { ...CANVAS, channels: 3, background: "#f5eef4" } })
    .composite([
      { input: backgroundSvg(CANVAS.width, CANVAS.height, 3), left: 0, top: 0 },
      { input: back, left: 80, top: 85 },
      { input: front, left: 520, top: 330 },
    ])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function triptych(slides: LoadedSlide[]) {
  const selected = [slides[0], slides[1] || slides[0], slides[2] || slides[0]];
  const frames = await Promise.all(selected.map((slide) => frame(slide.buffer, 660, 371)));
  return sharp({ create: { ...CANVAS, channels: 3, background: "#26173d" } })
    .composite([
      { input: backgroundSvg(CANVAS.width, CANVAS.height, 0), left: 0, top: 0 },
      { input: frames[0], left: 40, top: 115 },
      { input: frames[1], left: 900, top: 80 },
      { input: frames[2], left: 470, top: 505 },
    ])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
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
}) {
  const reviewedIndexes = input.review.slideAssessments
    .sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))
    .map((slide) => slide.slideIndex);
  const indexes = [...new Set([
    ...input.review.recommendedSlideIndexes,
    ...reviewedIndexes,
  ])].slice(0, 6);
  const slides = await loadSlides({
    bucket: input.bucket,
    slidePaths: input.slidePaths,
    indexes,
    sensitiveRegions: input.review.sensitiveRegions,
  });
  if (slides.length < 3) throw new Error("서로 다른 목업을 만들 슬라이드가 3장 미만입니다.");

  const outputs = [
    {
      kind: "thumbnail" as const,
      name: "thumbnail.jpg",
      bytes: await thumbnail(slides),
      caption: "프로젝트의 핵심 디자인 장면을 조합한 포트폴리오 대표 이미지",
      slideIndexes: slides.slice(0, 2).map((slide) => slide.index),
    },
    {
      kind: "body_image" as const,
      name: "main-collage.jpg",
      bytes: await heroCollage(slides),
      caption: "표지와 핵심 페이지를 한 화면에 구성한 메인 콜라주",
      slideIndexes: slides.slice(0, 3).map((slide) => slide.index),
    },
    {
      kind: "body_image" as const,
      name: "mockup-detail.jpg",
      bytes: await singleStage(slides[2] || slides[0]),
      caption: "핵심 정보 구조와 시각화 방식을 집중해서 보여주는 페이지",
      slideIndexes: [(slides[2] || slides[0]).index],
    },
    {
      kind: "body_image" as const,
      name: "mockup-pair.jpg",
      bytes: await offsetPair([slides[3] || slides[0], slides[4] || slides[1]]),
      caption: "서로 다른 목적의 페이지를 대비해 보여주는 이중 목업",
      slideIndexes: [slides[3] || slides[0], slides[4] || slides[1]].map((slide) => slide.index),
    },
    {
      kind: "body_image" as const,
      name: "mockup-triptych.jpg",
      bytes: await triptych([slides[1], slides[4] || slides[2], slides[5] || slides[3] || slides[0]]),
      caption: "문서 전체의 디자인 일관성과 페이지 변주를 보여주는 구성",
      slideIndexes: [slides[1], slides[4] || slides[2], slides[5] || slides[3] || slides[0]].map((slide) => slide.index),
    },
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
    });
  }
  return assets;
}
