import { createHash } from "node:crypto";
import sharp from "sharp";

import {
  APPROVED_16X9_BACKGROUNDS,
  APPROVED_MOCKUP_DEFAULT_TITLE_BOX,
  resolveApprovedMockupSlots,
  type ApprovedMockupBackgroundSpec,
  type ApprovedMockupLayer,
  type ApprovedMockupTemplateSpec,
  type ResolvedApprovedMockupSlot,
} from "./approved-16x9-templates.ts";
import { renderApprovedMockupTitle } from "./approved-mockup-title.ts";
import { approvedMockupAssetPath } from "./approved-mockup-runtime.ts";

type SharpOverlay = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];
type AnyApprovedMockupTemplateSpec = ApprovedMockupTemplateSpec<string, string, number>;

export type ApprovedMockupAssignedSlide = Readonly<{
  /** Zero-based index in the source presentation. */
  index: number;
  /** An already-redacted PNG or JPEG slide. */
  buffer: Buffer;
}>;

export type ApprovedMockupRenderScale = 0.5 | 1;

export type ResolvedApprovedMockupShadowLayer = Readonly<{
  filter: "drop-shadow" | "gaussian-blur";
  dx: number;
  dy: number;
  blur: number;
  opacity: number;
  color: string;
  surfaceColor: string;
  surfaceOpacity: number;
}>;

export type ResolvedApprovedMockupShadow = Readonly<{
  kind: ResolvedApprovedMockupSlot["shadow"]["kind"];
  layers: readonly ResolvedApprovedMockupShadowLayer[];
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
  rasterPlacement: ApprovedMockupRasterPlacement;
}>;

export type ApprovedMockupRasterPlacement = Readonly<{
  fittedWidth: number;
  fittedHeight: number;
  rotatedWidth: number;
  rotatedHeight: number;
  unclippedLeft: number;
  unclippedTop: number;
  sourceLeft: number;
  sourceTop: number;
  destinationLeft: number;
  destinationTop: number;
  visibleWidth: number;
  visibleHeight: number;
  clipped: boolean;
}>;

export type ApprovedMockupRenderResult = Readonly<{
  bytes: Buffer;
  templateId: AnyApprovedMockupTemplateSpec["id"];
  templateVersion: AnyApprovedMockupTemplateSpec["version"];
  outputName: AnyApprovedMockupTemplateSpec["outputName"];
  width: number;
  height: number;
  slotAssignments: ApprovedMockupSlotAssignment[];
}>;

export type ApprovedMockupRenderOptions = Readonly<{
  template: AnyApprovedMockupTemplateSpec;
  slides: readonly ApprovedMockupAssignedSlide[];
  /** Optional administrator title. It is only drawn on the thumbnail template. */
  title?: string | null;
  /** New strict renderer only. Legacy callers omit this and remain full-size. */
  scale?: ApprovedMockupRenderScale;
  /** New strict renderer only. Legacy callers omit this and remain JPEG. */
  outputFormat?: "jpeg" | "png";
  /** Absolute root of a verified standalone renderer package. */
  runtimeRoot?: string;
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

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function percentage(value: number) {
  return `${formatNumber(value * 100)}%`;
}

function scaled(value: number, scale: ApprovedMockupRenderScale) {
  return value * scale;
}

function scaleSlot(
  slot: ResolvedApprovedMockupSlot,
  scale: ApprovedMockupRenderScale,
): ResolvedApprovedMockupSlot {
  return {
    ...slot,
    x: scaled(slot.x, scale),
    y: scaled(slot.y, scale),
    width: scaled(slot.width, scale),
    height: scaled(slot.height, scale),
  };
}

/** The numeric shadow recipe used by both rendering and geometry manifests. */
export function resolveApprovedMockupShadow(
  templateKind: AnyApprovedMockupTemplateSpec["kind"],
  slot: ResolvedApprovedMockupSlot,
  scale: ApprovedMockupRenderScale,
): ResolvedApprovedMockupShadow {
  if (slot.shadow.kind === "custom") {
    return {
      kind: "custom",
      layers: slot.shadow.layers.map((layer) => ({
        filter: "gaussian-blur" as const,
        dx: scaled(layer.dx, scale),
        dy: scaled(layer.dy, scale),
        blur: scaled(layer.blur, scale),
        opacity: layer.opacity,
        color: layer.color || "#111820",
        surfaceColor: layer.color || "#111820",
        surfaceOpacity: layer.opacity,
      })),
    };
  }
  if (slot.role === "support") {
    const strength = slot.shadow.kind === "support" ? slot.shadow.strength : 1;
    const thumbnail = templateKind === "thumbnail";
    return {
      kind: slot.shadow.kind,
      layers: [{
        filter: "drop-shadow",
        dx: 0,
        dy: scaled((thumbnail ? 10 : 16) * strength, scale),
        blur: scaled((thumbnail ? 13 : 17) * strength, scale),
        opacity: Math.min(1, (thumbnail ? 0.2 : 0.34) * strength),
        color: "#111827",
        surfaceColor: "#111827",
        surfaceOpacity: Math.min(1, (thumbnail ? 0.06 : 0.09) * strength),
      }],
    };
  }
  return {
    kind: slot.shadow.kind,
    layers: [
      { filter: "drop-shadow", dx: 0, dy: scaled(18, scale), blur: scaled(22, scale),
        opacity: 0.28, color: "#111827", surfaceColor: "#ffffff", surfaceOpacity: 1 },
      { filter: "drop-shadow", dx: 0, dy: scaled(4, scale), blur: scaled(7, scale),
        opacity: 0.34, color: "#111827", surfaceColor: "#ffffff", surfaceOpacity: 1 },
    ],
  };
}

function backgroundSvg(
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
  background: ApprovedMockupBackgroundSpec,
  scale: ApprovedMockupRenderScale,
) {
  if (background.kind === "image") {
    throw new Error("이미지 배경은 승인된 로컬 에셋에서 읽어야 합니다.");
  }
  if (background.kind === "diagonal-split") {
    return Buffer.from(`<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${background.base.from}"/><stop offset="1" stop-color="${background.base.to}"/></linearGradient>
        <linearGradient id="lower" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${background.lower.from}"/><stop offset="1" stop-color="${background.lower.to}"/></linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#base)"/>
      <path d="M0 ${scaled(background.leftY, scale)} L${canvas.width} ${scaled(background.rightY, scale)} L${canvas.width} ${canvas.height} L0 ${canvas.height} Z" fill="url(#lower)"/>
    </svg>`);
  }
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

async function renderBackground(
  template: AnyApprovedMockupTemplateSpec,
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
  scale: ApprovedMockupRenderScale,
  runtimeRoot?: string,
): Promise<SharpOverlay> {
  const background: ApprovedMockupBackgroundSpec = APPROVED_16X9_BACKGROUNDS[template.backgroundId];
  if (!background) throw new Error(`승인되지 않은 목업 배경입니다: ${template.backgroundId}`);
  const input = background.kind === "image"
    ? await sharp(approvedMockupAssetPath(background.assetPath, runtimeRoot))
        .resize(canvas.width, canvas.height, { fit: "cover" })
        .modulate({ brightness: background.brightness, saturation: background.saturation })
        .png()
        .toBuffer()
    : backgroundSvg(canvas, background, scale);
  return { input, left: 0, top: 0 };
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
  templateKind: AnyApprovedMockupTemplateSpec["kind"],
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
  assignments: readonly PreparedAssignment[],
  scale: ApprovedMockupRenderScale,
) {
  const supportAssignments = assignments.filter(({ slot }) => (
    slot.role === "support" && slot.shadow.kind !== "custom"
  ));
  if (supportAssignments.length === 0) return null;

  const filters = supportAssignments.map(({ slot }, index) => {
    const layer = resolveApprovedMockupShadow(templateKind, slot, scale).layers[0];
    return `<filter id="support-shadow-${index}" x="-30%" y="-40%" width="180%" height="210%">
      <feDropShadow dx="${formatNumber(layer.dx)}" dy="${formatNumber(layer.dy)}" stdDeviation="${formatNumber(layer.blur)}" flood-color="${layer.color}" flood-opacity="${formatNumber(layer.opacity)}"/>
    </filter>`;
  }).join("");
  const polygons = supportAssignments.map(({ slot }, index) => {
    const layer = resolveApprovedMockupShadow(templateKind, slot, scale).layers[0];
    return `<polygon points="${polygonPoints(slot)}" fill="${layer.surfaceColor}" fill-opacity="${formatNumber(layer.surfaceOpacity)}" filter="url(#support-shadow-${index})"/>`;
  }).join("");

  return Buffer.from(`<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${filters}</defs>
    ${polygons}
  </svg>`);
}

function focusShadowSvg(
  templateKind: AnyApprovedMockupTemplateSpec["kind"],
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
  assignments: readonly PreparedAssignment[],
  scale: ApprovedMockupRenderScale,
) {
  const focusAssignments = assignments.filter(({ slot }) => (
    slot.role === "hero" && slot.shadow.kind !== "custom"
  ));
  if (focusAssignments.length === 0) return null;
  const filters = focusAssignments.map(({ slot }, index) => resolveApprovedMockupShadow(templateKind, slot, scale).layers
    .map((layer, layerIndex) => `<filter id="focus-${index}-${layerIndex}" ${layerIndex === 0
      ? 'x="-35%" y="-45%" width="190%" height="220%"'
      : 'x="-25%" y="-30%" width="160%" height="180%"'}>
      <feDropShadow dx="${formatNumber(layer.dx)}" dy="${formatNumber(layer.dy)}" stdDeviation="${formatNumber(layer.blur)}" flood-color="${layer.color}" flood-opacity="${formatNumber(layer.opacity)}"/>
    </filter>`).join("")).join("");
  const polygons = focusAssignments.map(({ slot }, index) => resolveApprovedMockupShadow(templateKind, slot, scale).layers
    .map((layer, layerIndex) => `<polygon points="${polygonPoints(slot)}" fill="${layer.surfaceColor}" fill-opacity="${formatNumber(layer.surfaceOpacity)}" filter="url(#focus-${index}-${layerIndex})"/>`)
    .join("")).join("");
  return Buffer.from(`<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${filters}</defs>
    ${polygons}
  </svg>`);
}

/** Fixed ambient/contact shadow layers copied from the approved portrait reference. */
function customShadowSvg(
  templateKind: AnyApprovedMockupTemplateSpec["kind"],
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
  assignments: readonly PreparedAssignment[],
  role: ResolvedApprovedMockupSlot["role"],
  scale: ApprovedMockupRenderScale,
) {
  const selected = assignments
    .filter(({ slot }) => slot.role === role && slot.shadow.kind === "custom")
    .sort((left, right) => left.slot.z - right.slot.z);
  if (selected.length === 0) return null;
  const definitions: string[] = [];
  const polygons: string[] = [];
  for (const [slotIndex, { slot }] of selected.entries()) {
    if (slot.shadow.kind !== "custom") continue;
    for (const [layerIndex, layer] of resolveApprovedMockupShadow(templateKind, slot, scale).layers.entries()) {
      const id = `custom-${role}-${slotIndex}-${layerIndex}`;
      definitions.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${formatNumber(layer.blur)}"/></filter>`);
      const points = rotatedGeometry(slot)
        .map(({ x, y }) => `${formatNumber(x + layer.dx)},${formatNumber(y + layer.dy)}`)
        .join(" ");
      polygons.push(`<polygon points="${points}" fill="${layer.surfaceColor}" fill-opacity="${formatNumber(layer.surfaceOpacity)}" filter="url(#${id})"/>`);
    }
  }
  return Buffer.from(`<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg"><defs>${definitions.join("")}</defs>${polygons.join("")}</svg>`);
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
    fittedWidth: width,
    fittedHeight: height,
    slot: assignment.slot,
  };
}

async function clippedOverlay(
  rendered: Awaited<ReturnType<typeof renderRotatedSlide>>,
  canvas: AnyApprovedMockupTemplateSpec["canvas"],
): Promise<{ overlay: SharpOverlay | null; placement: ApprovedMockupRasterPlacement }> {
  const sourceLeft = Math.max(0, -rendered.left);
  const sourceTop = Math.max(0, -rendered.top);
  const left = Math.max(0, rendered.left);
  const top = Math.max(0, rendered.top);
  const width = Math.min(rendered.width - sourceLeft, canvas.width - left);
  const height = Math.min(rendered.height - sourceTop, canvas.height - top);
  const clipped = sourceLeft !== 0
    || sourceTop !== 0
    || width !== rendered.width
    || height !== rendered.height;
  const placement: ApprovedMockupRasterPlacement = {
    fittedWidth: rendered.fittedWidth,
    fittedHeight: rendered.fittedHeight,
    rotatedWidth: rendered.width,
    rotatedHeight: rendered.height,
    unclippedLeft: rendered.left,
    unclippedTop: rendered.top,
    sourceLeft,
    sourceTop,
    destinationLeft: left,
    destinationTop: top,
    visibleWidth: Math.max(0, width),
    visibleHeight: Math.max(0, height),
    clipped,
  };

  if (width <= 0 || height <= 0) {
    if (rendered.slot.allowCanvasClip) return { overlay: null, placement };
    throw new Error(`목업 슬롯 ${rendered.slot.id}가 캔버스 밖에 있습니다.`);
  }
  if (clipped && !rendered.slot.allowCanvasClip) {
    throw new Error(`목업 슬롯 ${rendered.slot.id}는 캔버스 밖으로 잘릴 수 없습니다.`);
  }
  if (!clipped) return { overlay: { input: rendered.input, left, top }, placement };
  return {
    overlay: {
      input: await sharp(rendered.input).extract({
        left: sourceLeft,
        top: sourceTop,
        width,
        height,
      }).png().toBuffer(),
      left,
      top,
    },
    placement,
  };
}

function validateLayerOrder(layerOrder: readonly ApprovedMockupLayer[]) {
  if (layerOrder.length !== REQUIRED_LAYER_ORDER.length
    || layerOrder.some((layer, index) => layer !== REQUIRED_LAYER_ORDER[index])) {
    throw new Error(`승인 목업의 레이어 순서는 ${REQUIRED_LAYER_ORDER.join(" → ")} 이어야 합니다.`);
  }
}

function prepareAssignments(
  template: AnyApprovedMockupTemplateSpec,
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

/**
 * Renders one approved mockup as a reusable, smart-object-style image.
 * Slide buffers are assigned strictly by slot priority; all background,
 * geometry, shadow, logo and layer decisions stay locked in the template.
 */
export async function renderApprovedMockup(
  options: ApprovedMockupRenderOptions,
): Promise<ApprovedMockupRenderResult> {
  const { template, slides } = options;
  const scale = options.scale ?? 1;
  const outputFormat = options.outputFormat ?? "jpeg";
  if (scale !== 0.5 && scale !== 1) throw new Error("승인 목업 렌더 배율은 0.5 또는 1이어야 합니다.");
  if (outputFormat !== "jpeg" && outputFormat !== "png") {
    throw new Error("승인 목업 출력 형식은 jpeg 또는 png여야 합니다.");
  }
  const canvas = {
    width: Math.max(1, Math.round(template.canvas.width * scale)),
    height: Math.max(1, Math.round(template.canvas.height * scale)),
  };
  validateLayerOrder(template.layerOrder);
  // Resolve once from the frozen, unrounded template and scale those numbers
  // directly. Draft rendering never resizes a completed final board.
  const assignments = prepareAssignments(template, slides).map((assignment) => ({
    ...assignment,
    slot: scaleSlot(assignment.slot, scale),
  }));
  const renderedSlides = await Promise.all(assignments.map(renderRotatedSlide));
  const placedSlides = (await Promise.all(renderedSlides.map((rendered) => (
    clippedOverlay(rendered, canvas)
  ))));
  const slideLayers = assignments.map((assignment, index) => ({
    assignment,
    overlay: placedSlides[index].overlay,
  }));

  const background = await renderBackground(template, canvas, scale, options.runtimeRoot);
  const supportShadow = supportShadowSvg(template.kind, canvas, assignments, scale);
  const focusShadow = focusShadowSvg(template.kind, canvas, assignments, scale);
  const customSupportShadow = customShadowSvg(template.kind, canvas, assignments, "support", scale);
  const customFocusShadow = customShadowSvg(template.kind, canvas, assignments, "hero", scale);
  const logo: SharpOverlay = {
    input: await sharp(approvedMockupAssetPath(template.logo.assetPath, options.runtimeRoot))
      .resize({ width: Math.max(1, Math.round(template.logo.width * scale)) })
      .ensureAlpha()
      .png()
      .toBuffer(),
    left: Math.round(template.logo.left * scale),
    top: Math.round(template.logo.top * scale),
  };
  const title = template.kind === "thumbnail"
    ? await renderApprovedMockupTitle(options.title, (() => {
        const box = template.titleBox || APPROVED_MOCKUP_DEFAULT_TITLE_BOX;
        return { ...box, left: box.left * scale, top: box.top * scale,
          width: box.width * scale, height: box.height * scale, fontSize: box.fontSize * scale };
      })(), options.runtimeRoot)
    : null;

  const layers: Record<ApprovedMockupLayer, SharpOverlay[]> = {
    background: [background],
    "support-shadow": [supportShadow, customSupportShadow]
      .flatMap((input) => input ? [{ input, left: 0, top: 0 }] : []),
    support: slideLayers
      .filter(({ assignment, overlay }) => assignment.slot.role === "support" && overlay)
      .sort((left, right) => left.assignment.slot.z - right.assignment.slot.z)
      .map(({ overlay }) => overlay as SharpOverlay),
    "focus-shadow": [focusShadow, customFocusShadow]
      .flatMap((input) => input ? [{ input, left: 0, top: 0 }] : []),
    hero: slideLayers
      .filter(({ assignment, overlay }) => assignment.slot.role === "hero" && overlay)
      .sort((left, right) => left.assignment.slot.z - right.assignment.slot.z)
      .map(({ overlay }) => overlay as SharpOverlay),
    logo: title ? [logo, title] : [logo],
  };
  const composite = template.layerOrder.flatMap((layer) => layers[layer]);
  const image = sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composite);
  const bytes = outputFormat === "png"
    ? await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await image.jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();

  return {
    bytes,
    templateId: template.id,
    templateVersion: template.version,
    outputName: template.outputName,
    width: canvas.width,
    height: canvas.height,
    slotAssignments: assignments.map(({ slide, slot, contentHash }, index) => ({
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
      rasterPlacement: placedSlides[index].placement,
    })),
  };
}

/** Backward-compatible name retained for existing 16:9 callers. */
export const renderApproved16x9Mockup = renderApprovedMockup;
