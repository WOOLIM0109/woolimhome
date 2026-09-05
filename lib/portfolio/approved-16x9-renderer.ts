import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

import {
  APPROVED_16X9_BACKGROUNDS,
  resolveApprovedMockupSlots,
  type ApprovedMockupBackgroundSpec,
  type ApprovedMockupLayer,
  type ApprovedMockupTemplateSpec,
  type ResolvedApprovedMockupSlot,
} from "./approved-16x9-templates.ts";

type SharpOverlay = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

export type ApprovedMockupAssignedSlide = Readonly<{
  /** Zero-based index in the source presentation. */
  index: number;
  /** An already-redacted PNG or JPEG slide. */
  buffer: Buffer;
}>;

export type ApprovedMockupSlotAssignment = Readonly<{
  slotId: string;
  role: "hero" | "support";
  sourceSlideIndex: number;
  contentHash: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  z: number;
}>;

export type ApprovedMockupRenderResult = Readonly<{
  bytes: Buffer;
  templateId: ApprovedMockupTemplateSpec["id"];
  templateVersion: ApprovedMockupTemplateSpec["version"];
  outputName: ApprovedMockupTemplateSpec["outputName"];
  width: number;
  height: number;
  slotAssignments: ApprovedMockupSlotAssignment[];
}>;

export type ApprovedMockupRenderOptions = Readonly<{
  template: ApprovedMockupTemplateSpec;
  slides: readonly ApprovedMockupAssignedSlide[];
  /** Optional administrator title. It is only drawn on the thumbnail template. */
  title?: string | null;
}>;

type PreparedAssignment = Readonly<{
  slide: ApprovedMockupAssignedSlide;
  slot: ResolvedApprovedMockupSlot;
  contentHash: string;
}>;

const REQUIRED_LAYER_ORDER: readonly ApprovedMockupLayer[] = [
  "background",
  "support-shadow",
  "support",
  "focus-shadow",
  "hero",
  "logo",
];

const THUMBNAIL_TITLE_BOX = {
  left: 220,
  top: 24,
  width: 500,
  height: 58,
} as const;

function publicAssetPath(assetPath: string) {
  return path.join(process.cwd(), "public", assetPath.replace(/^[/\\]+/, ""));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function percentage(value: number) {
  return `${formatNumber(value * 100)}%`;
}

function backgroundSvg(
  canvas: ApprovedMockupTemplateSpec["canvas"],
  background: ApprovedMockupBackgroundSpec,
) {
  const gradient = background.kind === "linear-gradient"
    ? `<linearGradient id="background" x1="${percentage(background.vector.x1)}" y1="${percentage(background.vector.y1)}" x2="${percentage(background.vector.x2)}" y2="${percentage(background.vector.y2)}">
        <stop offset="0" stop-color="${background.from}"/>
        <stop offset="1" stop-color="${background.to}"/>
      </linearGradient>`
    : `<radialGradient id="background" cx="${percentage(background.center.x)}" cy="${percentage(background.center.y)}" r="${percentage(background.radius)}">
        ${background.stops.map((stop) => (
          `<stop offset="${formatNumber(stop.offset)}" stop-color="${stop.color}"/>`
        )).join("")}
      </radialGradient>`;

  return Buffer.from(`<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradient}</defs>
    <rect width="100%" height="100%" fill="url(#background)"/>
  </svg>`);
}

function rotatedGeometry(slot: ResolvedApprovedMockupSlot) {
  const radians = (slot.angle * Math.PI) / 180;
  const widthAxis = { x: Math.cos(radians), y: Math.sin(radians) };
  const heightAxis = { x: -Math.sin(radians), y: Math.cos(radians) };
  return [
    { x: slot.x, y: slot.y },
    {
      x: slot.x + slot.width * widthAxis.x,
      y: slot.y + slot.width * widthAxis.y,
    },
    {
      x: slot.x + slot.width * widthAxis.x + slot.height * heightAxis.x,
      y: slot.y + slot.width * widthAxis.y + slot.height * heightAxis.y,
    },
    {
      x: slot.x + slot.height * heightAxis.x,
      y: slot.y + slot.height * heightAxis.y,
    },
  ];
}

function polygonPoints(slot: ResolvedApprovedMockupSlot) {
  return rotatedGeometry(slot)
    .map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`)
    .join(" ");
}

function supportShadowSvg(
  template: ApprovedMockupTemplateSpec,
  assignments: readonly PreparedAssignment[],
) {
  const supportAssignments = assignments.filter(({ slot }) => slot.role === "support");
  if (supportAssignments.length === 0) return null;

  const filters = supportAssignments.map(({ slot }, index) => {
    const strength = slot.shadow.kind === "support" ? slot.shadow.strength : 1;
    if (template.kind === "thumbnail") {
      return `<filter id="support-shadow-${index}" x="-30%" y="-40%" width="180%" height="210%">
        <feDropShadow dx="0" dy="${formatNumber(10 * strength)}" stdDeviation="${formatNumber(13 * strength)}" flood-color="#111827" flood-opacity="${formatNumber(Math.min(1, 0.2 * strength))}"/>
      </filter>`;
    }
    return `<filter id="support-shadow-${index}" x="-30%" y="-40%" width="180%" height="210%">
      <feDropShadow dx="0" dy="${formatNumber(16 * strength)}" stdDeviation="${formatNumber(17 * strength)}" flood-color="#111827" flood-opacity="${formatNumber(Math.min(1, 0.34 * strength))}"/>
    </filter>`;
  }).join("");
  const polygons = supportAssignments.map(({ slot }, index) => {
    const strength = slot.shadow.kind === "support" ? slot.shadow.strength : 1;
    const baseOpacity = template.kind === "thumbnail" ? 0.06 : 0.09;
    return `<polygon points="${polygonPoints(slot)}" fill="#111827" fill-opacity="${formatNumber(Math.min(1, baseOpacity * strength))}" filter="url(#support-shadow-${index})"/>`;
  }).join("");

  return Buffer.from(`<svg width="${template.canvas.width}" height="${template.canvas.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${filters}</defs>
    ${polygons}
  </svg>`);
}

function focusShadowSvg(
  template: ApprovedMockupTemplateSpec,
  assignments: readonly PreparedAssignment[],
) {
  const focusAssignments = assignments.filter(({ slot }) => slot.role === "hero");
  if (focusAssignments.length === 0) return null;
  const filters = focusAssignments.map((_, index) => `<filter id="focus-ambient-${index}" x="-35%" y="-45%" width="190%" height="220%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#111827" flood-opacity=".28"/>
    </filter>
    <filter id="focus-contact-${index}" x="-25%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#111827" flood-opacity=".34"/>
    </filter>`).join("");
  const polygons = focusAssignments.map(({ slot }, index) => `<polygon points="${polygonPoints(slot)}" fill="#ffffff" filter="url(#focus-ambient-${index})"/>
    <polygon points="${polygonPoints(slot)}" fill="#ffffff" filter="url(#focus-contact-${index})"/>`).join("");
  return Buffer.from(`<svg width="${template.canvas.width}" height="${template.canvas.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${filters}</defs>
    ${polygons}
  </svg>`);
}

function rotatedTopLeftOffset(width: number, height: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = width / 2;
  const centerY = height / 2;
  const points = [
    { x: -centerX, y: -centerY },
    { x: centerX, y: -centerY },
    { x: centerX, y: centerY },
    { x: -centerX, y: centerY },
  ].map(({ x, y }) => ({
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }));
  return {
    x: points[0].x - Math.min(...points.map((point) => point.x)),
    y: points[0].y - Math.min(...points.map((point) => point.y)),
  };
}

async function renderRotatedSlide(
  assignment: PreparedAssignment,
) {
  const width = Math.max(1, Math.round(assignment.slot.width));
  const height = Math.max(1, Math.round(assignment.slot.height));
  const washes: SharpOverlay[] = assignment.slot.washOpacity > 0
    ? [{
        input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#ffffff" fill-opacity="${formatNumber(assignment.slot.washOpacity)}"/>
        </svg>`),
        left: 0,
        top: 0,
      }]
    : [];
  const fitted = await sharp(assignment.slide.buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width,
      height,
      fit: "contain",
      background: "#ffffff",
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .composite(washes)
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer();
  const rotated = assignment.slot.angle === 0
    ? await sharp(fitted).png().toBuffer({ resolveWithObject: true })
    : await sharp(fitted)
        .rotate(assignment.slot.angle, {
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 7, adaptiveFiltering: true })
        .toBuffer({ resolveWithObject: true });
  const offset = rotatedTopLeftOffset(width, height, assignment.slot.angle);
  return {
    input: rotated.data,
    width: rotated.info.width,
    height: rotated.info.height,
    left: Math.round(assignment.slot.x - offset.x),
    top: Math.round(assignment.slot.y - offset.y),
    slot: assignment.slot,
  };
}

async function clippedOverlay(
  rendered: Awaited<ReturnType<typeof renderRotatedSlide>>,
  canvas: ApprovedMockupTemplateSpec["canvas"],
): Promise<SharpOverlay | null> {
  const sourceLeft = Math.max(0, -rendered.left);
  const sourceTop = Math.max(0, -rendered.top);
  const left = Math.max(0, rendered.left);
  const top = Math.max(0, rendered.top);
  const width = Math.min(rendered.width - sourceLeft, canvas.width - left);
  const height = Math.min(rendered.height - sourceTop, canvas.height - top);

  if (width <= 0 || height <= 0) {
    if (rendered.slot.allowCanvasClip) return null;
    throw new Error(`목업 슬롯 ${rendered.slot.id}가 캔버스 밖에 있습니다.`);
  }
  const needsClipping = sourceLeft !== 0
    || sourceTop !== 0
    || width !== rendered.width
    || height !== rendered.height;
  if (needsClipping && !rendered.slot.allowCanvasClip) {
    throw new Error(`목업 슬롯 ${rendered.slot.id}는 캔버스 밖으로 잘릴 수 없습니다.`);
  }
  if (!needsClipping) return { input: rendered.input, left, top };
  return {
    input: await sharp(rendered.input).extract({
      left: sourceLeft,
      top: sourceTop,
      width,
      height,
    }).png().toBuffer(),
    left,
    top,
  };
}

function validateLayerOrder(layerOrder: readonly ApprovedMockupLayer[]) {
  if (layerOrder.length !== REQUIRED_LAYER_ORDER.length
    || layerOrder.some((layer, index) => layer !== REQUIRED_LAYER_ORDER[index])) {
    throw new Error(`승인 목업의 레이어 순서는 ${REQUIRED_LAYER_ORDER.join(" → ")} 이어야 합니다.`);
  }
}

function prepareAssignments(
  template: ApprovedMockupTemplateSpec,
  slides: readonly ApprovedMockupAssignedSlide[],
) {
  const slots = resolveApprovedMockupSlots(template);
  if (slides.length > slots.length) {
    throw new Error(
      `목업 ${template.id}의 슬롯은 ${slots.length}개이지만 장표 ${slides.length}개가 전달됐습니다.`,
    );
  }

  const indexes = new Set<number>();
  const hashes = new Set<string>();
  return slides.map((slide, position): PreparedAssignment => {
    if (!Number.isInteger(slide.index) || slide.index < 0) {
      throw new Error("승인 목업의 장표 인덱스는 0 이상의 정수여야 합니다.");
    }
    if (!Buffer.isBuffer(slide.buffer) || slide.buffer.length === 0) {
      throw new Error(`장표 ${slide.index + 1}의 이미지 데이터가 비어 있습니다.`);
    }
    const contentHash = createHash("sha256").update(slide.buffer).digest("hex");
    if (indexes.has(slide.index)) {
      throw new Error(`한 목업 안에서 장표 ${slide.index + 1}이 중복 배치될 수 없습니다.`);
    }
    if (hashes.has(contentHash)) {
      throw new Error("한 목업 안에서 내용이 같은 장표 이미지가 중복 배치될 수 없습니다.");
    }
    indexes.add(slide.index);
    hashes.add(contentHash);
    return { slide, slot: slots[position], contentHash };
  });
}

function wrapTitleToTwoLines(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const characters = Array.from(normalized);
  if (characters.length <= 20) return normalized;

  const midpoint = Math.floor(characters.length / 2);
  const spaces = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character === " ")
    .map(({ index }) => index);
  const splitAt = spaces.length > 0
    ? spaces.reduce((best, current) => (
        Math.abs(current - midpoint) < Math.abs(best - midpoint) ? current : best
      ))
    : midpoint;
  return `${characters.slice(0, splitAt).join("").trim()}\n${characters.slice(splitAt + (characters[splitAt] === " " ? 1 : 0)).join("").trim()}`;
}

async function titleOverlay(title: string | null | undefined): Promise<SharpOverlay | null> {
  const wrapped = wrapTitleToTwoLines(title || "");
  if (!wrapped) return null;
  const fontPath = publicAssetPath("/fonts/Paperlogy-7Bold.ttf");
  const input = await sharp({
    text: {
      text: `<span foreground="#27313a">${escapeXml(wrapped)}</span>`,
      font: "Paperlogy 7Bold 22",
      fontfile: fontPath,
      width: THUMBNAIL_TITLE_BOX.width,
      height: THUMBNAIL_TITLE_BOX.height,
      align: "right",
      justify: false,
      rgba: true,
      spacing: 0,
      wrap: "word-char",
    },
  }).png().toBuffer();
  return {
    input,
    left: THUMBNAIL_TITLE_BOX.left,
    top: THUMBNAIL_TITLE_BOX.top,
  };
}

/**
 * Renders one approved 16:9 mockup as a reusable, smart-object-style image.
 * Slide buffers are assigned strictly by slot priority; all background,
 * geometry, shadow, logo and layer decisions stay locked in the template.
 */
export async function renderApproved16x9Mockup(
  options: ApprovedMockupRenderOptions,
): Promise<ApprovedMockupRenderResult> {
  const { template, slides } = options;
  validateLayerOrder(template.layerOrder);
  const assignments = prepareAssignments(template, slides);
  const renderedSlides = await Promise.all(assignments.map(renderRotatedSlide));
  const placedSlides = (await Promise.all(renderedSlides.map((rendered) => (
    clippedOverlay(rendered, template.canvas)
  ))));
  const slideLayers = assignments.map((assignment, index) => ({
    assignment,
    overlay: placedSlides[index],
  }));

  const background = APPROVED_16X9_BACKGROUNDS[template.backgroundId];
  const supportShadow = supportShadowSvg(template, assignments);
  const focusShadow = focusShadowSvg(template, assignments);
  const logo: SharpOverlay = {
    input: await sharp(publicAssetPath(template.logo.assetPath))
      .resize({ width: template.logo.width })
      .ensureAlpha()
      .png()
      .toBuffer(),
    left: template.logo.left,
    top: template.logo.top,
  };
  const title = template.kind === "thumbnail" ? await titleOverlay(options.title) : null;

  const layers: Record<ApprovedMockupLayer, SharpOverlay[]> = {
    background: [{ input: backgroundSvg(template.canvas, background), left: 0, top: 0 }],
    "support-shadow": supportShadow ? [{ input: supportShadow, left: 0, top: 0 }] : [],
    support: slideLayers
      .filter(({ assignment, overlay }) => assignment.slot.role === "support" && overlay)
      .sort((left, right) => left.assignment.slot.z - right.assignment.slot.z)
      .map(({ overlay }) => overlay as SharpOverlay),
    "focus-shadow": focusShadow ? [{ input: focusShadow, left: 0, top: 0 }] : [],
    hero: slideLayers
      .filter(({ assignment, overlay }) => assignment.slot.role === "hero" && overlay)
      .sort((left, right) => left.assignment.slot.z - right.assignment.slot.z)
      .map(({ overlay }) => overlay as SharpOverlay),
    logo: title ? [logo, title] : [logo],
  };
  const composite = template.layerOrder.flatMap((layer) => layers[layer]);
  const bytes = await sharp({
    create: {
      width: template.canvas.width,
      height: template.canvas.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composite)
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();

  return {
    bytes,
    templateId: template.id,
    templateVersion: template.version,
    outputName: template.outputName,
    width: template.canvas.width,
    height: template.canvas.height,
    slotAssignments: assignments.map(({ slide, slot, contentHash }) => ({
      slotId: slot.id,
      role: slot.role,
      sourceSlideIndex: slide.index,
      contentHash,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      angle: slot.angle,
      z: slot.z,
    })),
  };
}
