import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const repoRoot = process.cwd();
const sourceRoot = process.argv[2] ?? process.env.DESIGN_PORTFOLIO_SOURCE_ROOT;
const reviewRoot = process.argv[3] ?? process.env.DESIGN_PORTFOLIO_REVIEW_ROOT;
const cacheRoot = process.argv[4] ?? process.env.DESIGN_PORTFOLIO_CACHE_ROOT;
const outputRoot = path.join(repoRoot, "public", "images", "design-portfolio");
const manifestPath = path.join(repoRoot, "docs", "design-portfolio-assets-manifest.json");
const pdfToPpm = process.env.PDFTOPPM_PATH ?? "pdftoppm";

if (!sourceRoot || !reviewRoot || !cacheRoot) {
  throw new Error(
    "Usage: node scripts/build-approved-design-portfolio.mjs <source-root> <review-root> <cache-root>",
  );
}

const records = [];

function ensureInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing filesystem operation outside ${parent}: ${target}`);
  }
}

async function resetOutputDirectory() {
  await fs.mkdir(outputRoot, { recursive: true });
  const entries = await fs.readdir(outputRoot, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(outputRoot, entry.name);
    ensureInside(outputRoot, target);
    await fs.rm(target, { recursive: true, force: true });
  }
}

async function renderPdfPage(input, pageNumber, cacheSlug, cacheName, scale = 2400) {
  const cacheDirectory = path.join(cacheRoot, cacheSlug);
  await fs.mkdir(cacheDirectory, { recursive: true });
  const outputPrefix = path.join(cacheDirectory, cacheName);
  const outputPath = `${outputPrefix}.png`;

  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {}

  const result = spawnSync(
    pdfToPpm,
    [
      "-png",
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-singlefile",
      "-scale-to",
      String(scale),
      input,
      outputPrefix,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
  );

  if (result.status !== 0) {
    throw new Error(`PDF render failed for ${input} page ${pageNumber}: ${result.stderr}`);
  }

  return outputPath;
}

function toRect(region, width, height) {
  const left = Math.max(0, Math.round(region.x * width));
  const top = Math.max(0, Math.round(region.y * height));
  const rectWidth = Math.min(width - left, Math.max(1, Math.round(region.width * width)));
  const rectHeight = Math.min(height - top, Math.max(1, Math.round(region.height * height)));
  return { left, top, width: rectWidth, height: rectHeight };
}

async function applySecureRects(input, regions, sigmaOverride) {
  if (regions.length === 0) return input;

  const metadata = await sharp(input).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const rects = regions.map((region) => toRect(region, width, height));
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      rects
        .map((rect) => {
          const radius = Math.max(4, Math.min(18, Math.round(rect.height * 0.18)));
          return `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" rx="${radius}" fill="white"/>`;
        })
        .join("") +
      `</svg>`,
  );
  const sigma = sigmaOverride ?? Math.max(20, Math.min(96, Math.round(width / 25)));
  const feather = Math.max(3, Math.min(10, Math.round(width / 240)));
  const featheredMask = await sharp(mask).blur(feather).png().toBuffer();
  const blurred = await sharp(input).blur(sigma).ensureAlpha().png().toBuffer();
  const maskedBlur = await sharp(blurred)
    .composite([{ input: featheredMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(input).composite([{ input: maskedBlur, left: 0, top: 0 }]).png().toBuffer();
}

async function applyDarkTextBlurs(input, regions) {
  if (regions.length === 0) return input;

  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const darkPixels = Buffer.alloc(width * height);

  for (const region of regions) {
    const rect = toRect(region, width, height);
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;

    for (let y = rect.top; y < bottom; y++) {
      let pixelIndex = (y * width + rect.left) * channels;
      let maskIndex = y * width + rect.left;

      for (let x = rect.left; x < right; x++) {
        const red = data[pixelIndex];
        const green = data[pixelIndex + 1];
        const blue = data[pixelIndex + 2];
        const lightness = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const colorRange = Math.max(red, green, blue) - Math.min(red, green, blue);

        if (lightness < 155 && colorRange < 48) darkPixels[maskIndex] = 255;

        pixelIndex += channels;
        maskIndex++;
      }
    }
  }

  const maskBlur = Math.max(4, Math.min(8, Math.round(width / 400)));
  const expandedMask = await sharp(darkPixels, { raw: { width, height, channels: 1 } })
    .blur(maskBlur)
    .linear(8)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgbaMask = Buffer.alloc(width * height * 4);

  for (let index = 0; index < width * height; index++) {
    const rgbaIndex = index * 4;
    rgbaMask[rgbaIndex] = 255;
    rgbaMask[rgbaIndex + 1] = 255;
    rgbaMask[rgbaIndex + 2] = 255;
    rgbaMask[rgbaIndex + 3] = expandedMask.data[index * expandedMask.info.channels];
  }

  const mask = await sharp(rgbaMask, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const sigma = Math.max(20, Math.min(96, Math.round(width / 25)));
  const blurred = await sharp(input).blur(sigma).ensureAlpha().png().toBuffer();
  const maskedBlur = await sharp(blurred)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(input).composite([{ input: maskedBlur, left: 0, top: 0 }]).png().toBuffer();
}

async function applyFaceBlurs(input, ellipses) {
  if (ellipses.length === 0) return input;

  const metadata = await sharp(input).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      ellipses
        .map(
          (ellipse) =>
            `<ellipse cx="${ellipse.cx * width}" cy="${ellipse.cy * height}" rx="${ellipse.rx * width}" ry="${ellipse.ry * height}" fill="white"/>`,
        )
        .join("") +
      `</svg>`,
  );

  const blurred = await sharp(input).blur(Math.max(28, Math.round(width / 70))).ensureAlpha().png().toBuffer();
  const maskedBlur = await sharp(blurred)
    .composite([{ input: svg, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(input).composite([{ input: maskedBlur, left: 0, top: 0 }]).png().toBuffer();
}

async function saveAsset({
  slug,
  number,
  input,
  secureRects = [],
  secureBlurSigma,
  darkTextRegions = [],
  faceBlurs = [],
  maxWidth = 2400,
  maxHeight = 2600,
}) {
  const outputDirectory = path.join(outputRoot, slug);
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${String(number).padStart(2, "0")}.webp`);

  let image = await sharp(input)
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  image = await applySecureRects(image, secureRects, secureBlurSigma);
  image = await applyDarkTextBlurs(image, darkTextRegions);
  image = await applyFaceBlurs(image, faceBlurs);

  const info = await sharp(image)
    .webp({ quality: 88, alphaQuality: 100, effort: 5 })
    .toFile(outputPath);

  records.push({
    project: slug,
    file: path.relative(repoRoot, outputPath).replaceAll("\\", "/"),
    width: info.width,
    height: info.height,
    bytes: info.size,
    redacted: secureRects.length > 0 || darkTextRegions.length > 0 || faceBlurs.length > 0,
  });
}

async function savePdfPages({ slug, input, pages, secureRectsByPage = {}, scale = 2400 }) {
  let number = 1;
  for (const pageNumber of pages) {
    const rendered = await renderPdfPage(
      input,
      pageNumber,
      slug,
      `page-${String(pageNumber).padStart(2, "0")}`,
      scale,
    );
    await saveAsset({
      slug,
      number,
      input: rendered,
      secureRects: secureRectsByPage[pageNumber] ?? [],
    });
    number++;
  }
}

async function build() {
  await resetOutputDirectory();
  await fs.mkdir(cacheRoot, { recursive: true });

  const sCompanyDarkTextRegions = {
    1: [{ x: 0, y: 0, width: 1, height: 1 }],
    2: [{ x: 0.18, y: 0.15, width: 0.78, height: 0.82 }],
    3: [
      { x: 0.42, y: 0.02, width: 0.16, height: 0.08 },
      { x: 0.02, y: 0.16, width: 0.2, height: 0.78 },
      { x: 0.78, y: 0.16, width: 0.2, height: 0.78 },
      { x: 0.25, y: 0.7, width: 0.52, height: 0.2 },
    ],
    4: [
      { x: 0.1, y: 0.32, width: 0.13, height: 0.06 },
      { x: 0.34, y: 0.32, width: 0.13, height: 0.06 },
      { x: 0.58, y: 0.32, width: 0.13, height: 0.06 },
      { x: 0.81, y: 0.32, width: 0.13, height: 0.06 },
      { x: 0.05, y: 0.5, width: 0.9, height: 0.42 },
    ],
    5: [
      { x: 0.04, y: 0.12, width: 0.3, height: 0.32 },
      { x: 0.04, y: 0.52, width: 0.3, height: 0.44 },
      { x: 0.39, y: 0.04, width: 0.57, height: 0.08 },
      { x: 0.49, y: 0.2, width: 0.27, height: 0.7 },
    ],
    6: [{ x: 0.01, y: 0.16, width: 0.98, height: 0.8 }],
    7: [
      { x: 0.22, y: 0.3, width: 0.22, height: 0.2 },
      { x: 0.22, y: 0.68, width: 0.22, height: 0.22 },
      { x: 0.51, y: 0.44, width: 0.23, height: 0.44 },
      { x: 0.8, y: 0.3, width: 0.19, height: 0.2 },
    ],
    8: [{ x: 0.22, y: 0.04, width: 0.7, height: 0.92 }],
    9: [{ x: 0.06, y: 0.56, width: 0.9, height: 0.38 }],
    10: [
      { x: 0.035, y: 0.13, width: 0.27, height: 0.78 },
      { x: 0.72, y: 0.13, width: 0.27, height: 0.78 },
    ],
  };
  for (const number of Array.from({ length: 10 }, (_, index) => index + 1)) {
    await saveAsset({
      slug: "s-company-infographic",
      number,
      input: path.join(sourceRoot, "s-company-infographic", `diagram-${String(number).padStart(2, "0")}.jpg`),
      darkTextRegions: sCompanyDarkTextRegions[number],
    });
  }

  await savePdfPages({
    slug: "wegofair-wall",
    input: path.join(sourceRoot, "wegofair-wall", "wall.pdf"),
    pages: [1, 2, 3],
    scale: 2600,
  });

  await saveAsset({
    slug: "allclean-card",
    number: 1,
    input: path.join(sourceRoot, "allclean-card", "front-02.jpg"),
    secureRects: [
      { x: 0.54, y: 0.55, width: 0.4, height: 0.11 },
      { x: 0.54, y: 0.67, width: 0.4, height: 0.11 },
      { x: 0.03, y: 0.81, width: 0.94, height: 0.13 },
    ],
  });
  await saveAsset({
    slug: "allclean-card",
    number: 2,
    input: path.join(sourceRoot, "allclean-card", "back-04.jpg"),
    secureRects: [{ x: 0.24, y: 0.82, width: 0.69, height: 0.13 }],
  });

  for (const [number, sourceName] of [
    [1, "ieoon-lockup.png"],
    [2, "ieoon-symbol.png"],
    [3, "dayhug-lockup.png"],
  ]) {
    await saveAsset({ slug: "yearon-dayhug", number, input: path.join(reviewRoot, sourceName) });
  }

  for (const number of [1, 2, 3]) {
    await saveAsset({
      slug: "sinacell-logo",
      number,
      input: path.join(reviewRoot, `sinacell-0${number}.png`),
    });
  }

  for (const [number, sourceName, secureRects] of [
    [1, "logo-board.jpg", []],
    [
      2,
      "card-front.png",
      [
        { x: 0.17, y: 0.71, width: 0.22, height: 0.065 },
        { x: 0.17, y: 0.79, width: 0.34, height: 0.065 },
        { x: 0.17, y: 0.87, width: 0.38, height: 0.075 },
      ],
    ],
    [3, "card-back-black.png", []],
    [4, "card-back-red.png", []],
    [5, "card-back-white.png", []],
  ]) {
    await saveAsset({
      slug: "onlyone-universe",
      number,
      input: path.join(sourceRoot, "onlyone", sourceName),
      secureRects,
      secureBlurSigma: number === 2 ? 72 : undefined,
    });
  }

  const yuwolBoard = await renderPdfPage(
    path.join(sourceRoot, "yuwol-kitchen", "logo.pdf"),
    1,
    "yuwol-kitchen",
    "brand-board",
    2400,
  );
  await saveAsset({ slug: "yuwol-kitchen", number: 1, input: yuwolBoard });
  await saveAsset({ slug: "yuwol-kitchen", number: 2, input: path.join(sourceRoot, "yuwol-kitchen", "logo.png") });

  await savePdfPages({
    slug: "pamity-wall",
    input: path.join(sourceRoot, "pamity-wall", "wall.pdf"),
    pages: [1],
    scale: 2800,
  });

  await savePdfPages({
    slug: "k-rotary",
    input: path.join(sourceRoot, "k-rotary", "source.ai"),
    pages: [1, 2],
    scale: 3000,
  });

  await saveAsset({
    slug: "sinacell-stationery",
    number: 1,
    input: path.join(sourceRoot, "sinacell-stationery", "envelope-large.png"),
  });
  await saveAsset({
    slug: "sinacell-stationery",
    number: 2,
    input: path.join(sourceRoot, "sinacell-stationery", "envelope-small.png"),
  });
  const sinacellCardRects = {
    1: [
      { x: 0.68, y: 0.24, width: 0.27, height: 0.1 },
      { x: 0.1, y: 0.54, width: 0.84, height: 0.12 },
      { x: 0.1, y: 0.65, width: 0.78, height: 0.12 },
      { x: 0.09, y: 0.77, width: 0.84, height: 0.2 },
    ],
    2: [
      { x: 0.24, y: 0.21, width: 0.73, height: 0.11 },
      { x: 0.1, y: 0.51, width: 0.85, height: 0.13 },
      { x: 0.1, y: 0.63, width: 0.78, height: 0.13 },
      { x: 0.09, y: 0.74, width: 0.86, height: 0.22 },
    ],
  };
  let stationeryNumber = 3;
  for (const pageNumber of [1, 2]) {
    const card = await renderPdfPage(
      path.join(sourceRoot, "sinacell-stationery", "business-card.pdf"),
      pageNumber,
      "sinacell-stationery",
      `card-${pageNumber}`,
      2200,
    );
    await saveAsset({
      slug: "sinacell-stationery",
      number: stationeryNumber,
      input: card,
      secureRects: sinacellCardRects[pageNumber],
    });
    stationeryNumber++;
  }

  await savePdfPages({
    slug: "sinacell-catalog",
    input: path.join(sourceRoot, "sinacell-catalog", "catalog.pdf"),
    pages: [1, 2, 3, 4, 7, 8, 10, 11],
    scale: 2400,
  });

  const careerMasks = [
    {
      source: "career-sep-01.png",
      faces: [
        { cx: 0.75, cy: 0.37, rx: 0.105, ry: 0.085 },
        { cx: 0.72, cy: 0.68, rx: 0.1, ry: 0.075 },
      ],
    },
    {
      source: "career-sep-02.png",
      faces: [
        { cx: 0.75, cy: 0.36, rx: 0.105, ry: 0.085 },
        { cx: 0.72, cy: 0.68, rx: 0.1, ry: 0.075 },
      ],
    },
    {
      source: "career-oct-01.png",
      faces: [
        { cx: 0.78, cy: 0.35, rx: 0.1, ry: 0.08 },
        { cx: 0.72, cy: 0.64, rx: 0.1, ry: 0.075 },
      ],
    },
    {
      source: "career-oct-02.png",
      faces: [
        { cx: 0.76, cy: 0.36, rx: 0.1, ry: 0.08 },
        { cx: 0.76, cy: 0.64, rx: 0.1, ry: 0.075 },
      ],
    },
  ];
  for (const [index, item] of careerMasks.entries()) {
    await saveAsset({
      slug: "career-concert",
      number: index + 1,
      input: path.join(reviewRoot, item.source),
      faceBlurs: item.faces,
    });
  }

  const wCompanyRects = {
    1: [
      { x: 0.16, y: 0.66, width: 0.19, height: 0.17 },
      { x: 0.02, y: 0.9, width: 0.49, height: 0.09 },
    ],
    2: [
      { x: 0.17, y: 0.02, width: 0.19, height: 0.05 },
      { x: 0.68, y: 0.02, width: 0.19, height: 0.05 },
    ],
  };
  let wCompanyNumber = 1;
  for (const fileName of ["leaflet-ko.pdf", "leaflet-en.pdf"]) {
    for (const pageNumber of [1, 2]) {
      const page = await renderPdfPage(
        path.join(sourceRoot, "w-company-leaflet", fileName),
        pageNumber,
        "w-company-leaflet",
        `${path.parse(fileName).name}-${pageNumber}`,
        2600,
      );
      await saveAsset({
        slug: "w-company-leaflet",
        number: wCompanyNumber,
        input: page,
        secureRects: wCompanyRects[pageNumber],
      });
      wCompanyNumber++;
    }
  }

  for (const [number, sourceName] of [
    [1, "menu.png"],
    [2, "signboard.jpg"],
    [3, "banner.jpg"],
  ]) {
    await saveAsset({ slug: "just-drip", number, input: path.join(sourceRoot, "just-drip", sourceName) });
  }

  await savePdfPages({
    slug: "clean-care-catalog",
    input: path.join(sourceRoot, "clean-care-catalog", "catalog.pdf"),
    pages: [1, 2, 3, 4, 5, 7, 8],
    secureRectsByPage: {
      8: [
        { x: 0.06, y: 0.64, width: 0.43, height: 0.08 },
        { x: 0.06, y: 0.73, width: 0.58, height: 0.08 },
      ],
    },
    scale: 2400,
  });

  const catchCover = await renderPdfPage(
    path.join(sourceRoot, "catchcloud-forum", "cover.pdf"),
    1,
    "catchcloud-forum",
    "cover",
    2600,
  );
  await saveAsset({ slug: "catchcloud-forum", number: 1, input: catchCover });
  let catchNumber = 2;
  for (const pageNumber of [1, 3, 17, 30, 31]) {
    const page = await renderPdfPage(
      path.join(sourceRoot, "catchcloud-forum", "interior.pdf"),
      pageNumber,
      "catchcloud-forum",
      `interior-${String(pageNumber).padStart(2, "0")}`,
      2400,
    );
    await saveAsset({ slug: "catchcloud-forum", number: catchNumber, input: page });
    catchNumber++;
  }

  for (const [number, pageNumber] of [1, 5, 6, 7, 12, 29, 70, 82, 83, 85].entries()) {
    await saveAsset({
      slug: "dream-attic",
      number: number + 1,
      input: path.join(sourceRoot, "dream-attic", `page-${String(pageNumber).padStart(2, "0")}.jpg`),
    });
  }

  const cCompanyRects = [
    { x: 0.043, y: 0.355, width: 0.175, height: 0.065 },
    { x: 0.041, y: 0.783, width: 0.12, height: 0.06 },
    { x: 0.018, y: 0.848, width: 0.15, height: 0.035 },
    { x: 0.018, y: 0.878, width: 0.235, height: 0.035 },
    { x: 0.018, y: 0.908, width: 0.235, height: 0.035 },
    { x: 0.018, y: 0.938, width: 0.235, height: 0.045 },
    { x: 0.575, y: 0.2, width: 0.17, height: 0.032 },
    { x: 0.575, y: 0.625, width: 0.205, height: 0.025 },
    { x: 0.575, y: 0.657, width: 0.205, height: 0.025 },
    { x: 0.575, y: 0.758, width: 0.255, height: 0.056 },
    { x: 0.785, y: 0.185, width: 0.19, height: 0.11 },
    { x: 0.833, y: 0.885, width: 0.145, height: 0.03 },
    { x: 0.833, y: 0.925, width: 0.145, height: 0.025 },
  ];
  const cCompanyBackRects = [
    { x: 0.018, y: 0.09, width: 0.18, height: 0.11 },
    { x: 0.13, y: 0.28, width: 0.12, height: 0.055 },
    { x: 0.515, y: 0.045, width: 0.15, height: 0.055 },
    { x: 0.65, y: 0.245, width: 0.08, height: 0.06 },
    { x: 0.282, y: 0.475, width: 0.065, height: 0.055 },
    { x: 0.52, y: 0.66, width: 0.06, height: 0.06 },
    { x: 0.59, y: 0.66, width: 0.06, height: 0.06 },
    { x: 0.675, y: 0.64, width: 0.055, height: 0.13 },
  ];
  await saveAsset({
    slug: "c-company-leaflet",
    number: 1,
    input: path.join(sourceRoot, "c-company-leaflet", "spread-01.jpg"),
    secureRects: cCompanyRects,
  });
  await saveAsset({
    slug: "c-company-leaflet",
    number: 2,
    input: path.join(sourceRoot, "c-company-leaflet", "spread-02.jpg"),
    secureRects: cCompanyBackRects,
  });

  await savePdfPages({
    slug: "pamity-panel-ko",
    input: path.join(sourceRoot, "pamity-panel-ko", "panel.pdf"),
    pages: [1],
    scale: 2600,
  });
  await savePdfPages({
    slug: "pamity-panel-en",
    input: path.join(sourceRoot, "pamity-panel-en", "panel.pdf"),
    pages: [1],
    scale: 2600,
  });

  let expoNumber = 1;
  for (const fileName of ["h-company.pdf", "m-company.pdf"]) {
    for (const pageNumber of [1, 2]) {
      const page = await renderPdfPage(
        path.join(sourceRoot, "expo-flyers", fileName),
        pageNumber,
        "expo-flyers",
        `${path.parse(fileName).name}-${pageNumber}`,
        2400,
      );
      await saveAsset({ slug: "expo-flyers", number: expoNumber, input: page });
      expoNumber++;
    }
  }

  await saveAsset({
    slug: "ai-support-poster",
    number: 1,
    input: path.join(sourceRoot, "ai-support-poster", "poster.png"),
    faceBlurs: [
      { cx: 0.83, cy: 0.12, rx: 0.1, ry: 0.09 },
      { cx: 0.425, cy: 0.735, rx: 0.085, ry: 0.075 },
      { cx: 0.845, cy: 0.735, rx: 0.085, ry: 0.075 },
    ],
    secureRects: [
      { x: 0.7, y: 0.38, width: 0.28, height: 0.06 },
      { x: 0.74, y: 0.48, width: 0.2, height: 0.05 },
      { x: 0.74, y: 0.55, width: 0.2, height: 0.05 },
      { x: 0.74, y: 0.62, width: 0.21, height: 0.05 },
      { x: 0.07, y: 0.75, width: 0.27, height: 0.07 },
      { x: 0.54, y: 0.75, width: 0.3, height: 0.07 },
    ],
  });

  await savePdfPages({
    slug: "startup-poster",
    input: path.join(sourceRoot, "startup-poster", "poster.pdf"),
    pages: [1],
    scale: 2600,
  });

  for (const [number, sourceName] of [
    [1, "poster-eventus.jpg"],
    [2, "poster-onoffmix.jpg"],
  ]) {
    await saveAsset({
      slug: "buyer-response-poster",
      number,
      input: path.join(sourceRoot, "buyer-response-poster", sourceName),
    });
  }

  let waterNumber = 1;
  for (const fileName of ["poster-01.pdf", "poster-02.pdf"]) {
    const page = await renderPdfPage(
      path.join(sourceRoot, "water-research-poster", fileName),
      1,
      "water-research-poster",
      path.parse(fileName).name,
      2600,
    );
    await saveAsset({ slug: "water-research-poster", number: waterNumber, input: page });
    waterNumber++;
  }

  await savePdfPages({
    slug: "hpc-poster",
    input: path.join(sourceRoot, "hpc-poster", "poster.pdf"),
    pages: [1],
    scale: 2800,
  });

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        projectCount: new Set(records.map((record) => record.project)).size,
        imageCount: records.length,
        redactedImageCount: records.filter((record) => record.redacted).length,
        records,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `Built ${records.length} portfolio images across ${new Set(records.map((record) => record.project)).size} projects.`,
  );
}

await build();
