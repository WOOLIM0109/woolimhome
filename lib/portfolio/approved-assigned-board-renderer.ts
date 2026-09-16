import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

import {
  APPROVED_16X9_BACKGROUNDS,
  APPROVED_MOCKUP_DEFAULT_TITLE_BOX,
  resolveApprovedMockupSlots,
  type ApprovedMockupLayer,
  type ApprovedMockupTemplateSpec,
  type ApprovedMockupTitleBox,
  type ResolvedApprovedMockupSlot,
} from "./approved-16x9-templates.ts";
import {
  renderApprovedMockup,
  resolveApprovedMockupShadow,
  type ApprovedMockupAssignedSlide,
  type ApprovedMockupRasterPlacement,
  type ApprovedMockupRenderResult,
  type ApprovedMockupRenderScale,
  type ApprovedMockupSlotAssignment,
  type ResolvedApprovedMockupShadow,
} from "./approved-16x9-renderer.ts";
import { approvedSlotPolygon, inspectApprovedTemplateGeometry } from "./approved-mockup-geometry.ts";
import { approvedTemplateFingerprint } from "./approved-mockup-suite-renderer.ts";
import {
  padA4SourceSlide,
  type A4SourceAspectClass,
  type A4SourceFitReceipt,
  type A4SourceKind,
} from "./a4-source-fit.ts";
import {
  APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES,
  approvedMockupPublicAssetRelativePath,
  inspectApprovedMockupRuntime,
} from "./approved-mockup-runtime.ts";
import {
  approvedMockupSuiteTemplates,
  getRegisteredApprovedMockupSuite,
  type ApprovedMockupSuite,
} from "./approved-mockup-suites.ts";

type AnyTemplate = ApprovedMockupTemplateSpec<string, string, number>;
type Point = Readonly<{ x: number; y: number }>;
type ScaledBox = Readonly<{ left: number; top: number; width: number }>;

export const APPROVED_BOARD_RENDERER_VERSION = "approved-board-renderer-v2" as const;

export type ApprovedBoardA4SourceFit = Readonly<{
  sourceWidth: number;
  sourceHeight: number;
  aspectClass: A4SourceAspectClass;
  sourceKind: A4SourceKind;
}>;

export type ApprovedBoardSlotManifest = Readonly<{
  slotId: string;
  /** Zero-based physical position in resolveApprovedMockupSlots(). */
  slotIndex: number;
  /** Zero-based source presentation index, matching ApprovedMockupAssignedSlide. */
  sourceSlideIndex: number;
  /** Hash of the approved redaction output, before any white source-fit padding. */
  contentHash: string;
  /** Hash of the exact buffer passed into the frozen geometry renderer. */
  renderInputHash: string;
  /** Deterministic A4 padding proof. Omitted on the original strict path. */
  sourceFit?: A4SourceFitReceipt;
  role: ResolvedApprovedMockupSlot["role"];
  layer: "support" | "hero";
  z: number;
  allowCanvasClip: boolean;
  baseGeometry: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
  }>;
  transformedCorners: readonly Point[];
  shadow: ResolvedApprovedMockupShadow;
  /** Exact integer placement produced by Sharp, including any approved canvas crop. */
  rasterPlacement: ApprovedMockupRasterPlacement;
}>;

export type ApprovedBoardGeometryManifest = Readonly<{
  schemaVersion: 2;
  rendererVersion: typeof APPROVED_BOARD_RENDERER_VERSION;
  format: "png";
  rasterization: "direct";
  rendererFingerprint: string;
  geometryHash: string;
  aspectClass: string;
  suiteId: string;
  templateId: string;
  templateVersion: string;
  scale: ApprovedMockupRenderScale;
  baseCanvas: Readonly<{ width: number; height: number }>;
  outputCanvas: Readonly<{ width: number; height: number }>;
  background: Readonly<{ id: string }>;
  layerOrder: readonly ApprovedMockupLayer[];
  logo: Readonly<ScaledBox & { assetPath: string; z: number }>;
  titleBox: Readonly<(ScaledBox & { height: number; fontSize: number; color: string; align: "left" | "center" | "right" })> | null;
  slots: readonly ApprovedBoardSlotManifest[];
}>;

export type ApprovedAssignedBoardRenderResult = Readonly<
  Omit<ApprovedMockupRenderResult, "outputName"> & {
    bytes: Buffer;
    debugBytes: Buffer;
    format: "png";
    outputName: string;
    geometryHash: string;
    rendererFingerprint: string;
    manifest: ApprovedBoardGeometryManifest;
  }
>;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function templateFor(aspectClass: string, templateId: string) {
  const suite: ApprovedMockupSuite | null = getRegisteredApprovedMockupSuite(aspectClass);
  if (!suite) throw new Error(`승인된 목업 세트가 없는 규격입니다: ${aspectClass}`);
  const template = approvedMockupSuiteTemplates(suite).find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`${aspectClass} 세트에 승인된 목업 템플릿이 없습니다: ${templateId}`);
  return { suite, template: template as AnyTemplate };
}

/**
 * Cache fingerprint for runtime rendering dependencies. Frozen template
 * geometry remains untouched; changing an actually referenced asset or this
 * implementation version creates a new renderer fingerprint.
 */
export async function approvedBoardRendererFingerprint(
  aspectClass: string,
  templateId: string,
  options?: Readonly<{ runtimeRoot?: string }>,
) {
  const { suite, template } = templateFor(aspectClass, templateId);
  const background = APPROVED_16X9_BACKGROUNDS[template.backgroundId];
  if (!background) throw new Error(`승인되지 않은 목업 배경입니다: ${template.backgroundId}`);
  const assetPaths = new Set<string>([template.logo.assetPath]);
  if (background.kind === "image") assetPaths.add(background.assetPath);
  if (template.kind === "thumbnail") assetPaths.add("/fonts/Paperlogy-7Bold.ttf");
  const assetFiles = [...assetPaths].sort().map(approvedMockupPublicAssetRelativePath);
  const runtime = await inspectApprovedMockupRuntime({
    runtimeRoot: options?.runtimeRoot,
    requireManifest: Boolean(options?.runtimeRoot),
    requiredPaths: [...APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES, ...assetFiles],
  });
  const implementations = runtime.files
    .filter((file) => file.kind === "implementation")
    .map(({ path: filePath, bytes, sha256: fileHash }) => ({
      path: filePath,
      bytes,
      sha256: fileHash,
    }));
  const assets = runtime.files
    .filter((file) => file.kind === "asset")
    .map(({ path: filePath, bytes, sha256: fileHash }) => ({
      path: filePath,
      bytes,
      sha256: fileHash,
    }));
  return sha256(JSON.stringify({
    rendererVersion: APPROVED_BOARD_RENDERER_VERSION,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    aspectClass: suite.aspectClass,
    templateId: template.id,
    geometryHash: approvedTemplateFingerprint(template),
    assets,
    implementations,
    sharpVersions: runtime.sharpVersions,
  }));
}

async function validateAssignedSlides(
  suite: ApprovedMockupSuite,
  template: AnyTemplate,
  slides: readonly ApprovedMockupAssignedSlide[],
  a4SourceFit?: ApprovedBoardA4SourceFit,
) {
  const slots = resolveApprovedMockupSlots(template);
  if (slides.length !== slots.length) {
    throw new Error(`${template.id}의 필수 슬롯은 ${slots.length}개입니다. 장표도 정확히 ${slots.length}개여야 합니다. 현재 ${slides.length}개입니다.`);
  }
  if (a4SourceFit && (suite.aspectClass !== "a4_landscape" && suite.aspectClass !== "a4_portrait")) {
    throw new Error("A4 원본 맞춤은 승인된 A4 가로형 또는 세로형 세트에만 사용할 수 있습니다.");
  }
  if (a4SourceFit && a4SourceFit.aspectClass !== suite.aspectClass) {
    throw new Error("A4 원본 맞춤 규격과 승인 목업 세트 규격이 다릅니다.");
  }
  const indexes = new Set<number>();
  const sourceHashes = new Set<string>();
  const renderInputHashes = new Set<string>();
  const contentHashes: string[] = [];
  const fittedInputHashes: string[] = [];
  const sourceFits: (A4SourceFitReceipt | undefined)[] = [];
  const renderSlides: ApprovedMockupAssignedSlide[] = [];
  for (const slide of slides) {
    if (!Number.isInteger(slide.index) || slide.index < 0) {
      throw new Error("승인 목업의 장표 인덱스는 0 이상의 정수여야 합니다.");
    }
    if (indexes.has(slide.index)) throw new Error(`원본 장표 ${slide.index + 1}이 중복됐습니다.`);
    if (!Buffer.isBuffer(slide.buffer) || slide.buffer.length === 0) {
      throw new Error(`장표 ${slide.index + 1} 이미지가 비어 있습니다.`);
    }
    const contentHash = sha256(slide.buffer);
    if (sourceHashes.has(contentHash)) throw new Error("내용이 같은 원본 장표 PNG 해시가 중복됐습니다.");
    let sourceMetadata: Metadata;
    try {
      sourceMetadata = await sharp(slide.buffer).metadata();
    } catch {
      throw new Error(`장표 ${slide.index + 1} 이미지가 해독되지 않습니다.`);
    }
    let renderSlide = slide;
    let sourceFit: A4SourceFitReceipt | undefined;
    if (a4SourceFit) {
      const fitted = await padA4SourceSlide({ buffer: slide.buffer, ...a4SourceFit });
      if (!fitted || !Buffer.isBuffer(fitted.bytes) || fitted.bytes.length === 0 || !fitted.receipt) {
        throw new Error("A4_SOURCE_FIT_RESULT_INVALID");
      }
      const resultHash = sha256(fitted.bytes);
      if (fitted.receipt.sourceHash !== contentHash
        || fitted.receipt.resultHash !== resultHash
        || fitted.receipt.sourceWidth !== a4SourceFit.sourceWidth
        || fitted.receipt.sourceHeight !== a4SourceFit.sourceHeight
        || fitted.receipt.sourceKind !== a4SourceFit.sourceKind
        || fitted.receipt.targetAspectClass !== suite.aspectClass
        || fitted.receipt.scale !== 1
        || fitted.receipt.crop !== false) {
        throw new Error("A4_SOURCE_FIT_RECEIPT_INVALID");
      }
      renderSlide = { index: slide.index, buffer: fitted.bytes };
      sourceFit = fitted.receipt;
    }
    const renderInputHash = sha256(renderSlide.buffer);
    if (renderInputHashes.has(renderInputHash)) {
      throw new Error("내용이 같은 목업 입력 PNG 해시가 중복됐습니다.");
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(renderSlide.buffer).metadata();
    } catch {
      throw new Error(`장표 ${slide.index + 1} 이미지가 해독되지 않습니다.`);
    }
    const orientation = metadata.orientation || 1;
    const rotated = [5, 6, 7, 8].includes(orientation);
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    if (sourceFit) {
      const padding = sourceFit.padding;
      const paddingValues = [padding.top, padding.right, padding.bottom, padding.left];
      if (sourceFit.version !== 1
        || !Number.isSafeInteger(sourceFit.sourcePixelWidth)
        || !Number.isSafeInteger(sourceFit.sourcePixelHeight)
        || !Number.isSafeInteger(sourceFit.targetWidth)
        || !Number.isSafeInteger(sourceFit.targetHeight)
        || paddingValues.some((value) => !Number.isSafeInteger(value) || value < 0)
        || sourceFit.sourcePixelWidth !== sourceMetadata.width
        || sourceFit.sourcePixelHeight !== sourceMetadata.height
        || sourceFit.targetWidth !== metadata.width
        || sourceFit.targetHeight !== metadata.height
        || sourceFit.sourcePixelWidth + padding.left + padding.right !== sourceFit.targetWidth
        || sourceFit.sourcePixelHeight + padding.top + padding.bottom !== sourceFit.targetHeight) {
        throw new Error("A4_SOURCE_FIT_RECEIPT_INVALID");
      }
    }
    if (!width || !height || !["png", "jpeg"].includes(metadata.format || "")
      || Math.abs(width / height / template.slideAspectRatio - 1) > 0.005) {
      throw new Error(`장표 ${slide.index + 1}의 비율이 ${suite.aspectClass} 템플릿과 다릅니다. 늘이거나 잘라서 맞추지 않습니다.`);
    }
    indexes.add(slide.index);
    sourceHashes.add(contentHash);
    renderInputHashes.add(renderInputHash);
    contentHashes.push(contentHash);
    fittedInputHashes.push(renderInputHash);
    sourceFits.push(sourceFit);
    renderSlides.push(renderSlide);
  }
  return { slots, contentHashes, renderInputHashes: fittedInputHashes, sourceFits, renderSlides };
}

function scaledPoint(point: Point, scale: ApprovedMockupRenderScale): Point {
  return { x: point.x * scale, y: point.y * scale };
}

function manifestFor(input: {
  suite: ApprovedMockupSuite;
  template: AnyTemplate;
  slides: readonly ApprovedMockupAssignedSlide[];
  slots: readonly ResolvedApprovedMockupSlot[];
  contentHashes: readonly string[];
  renderInputHashes: readonly string[];
  sourceFits: readonly (A4SourceFitReceipt | undefined)[];
  renderedAssignments: readonly ApprovedMockupSlotAssignment[];
  scale: ApprovedMockupRenderScale;
  rendererFingerprint: string;
}): ApprovedBoardGeometryManifest {
  const { suite, template, slides, slots, contentHashes, renderInputHashes, sourceFits, renderedAssignments,
    scale, rendererFingerprint } = input;
  const titleBox: ApprovedMockupTitleBox | null = template.kind === "thumbnail"
    ? template.titleBox || APPROVED_MOCKUP_DEFAULT_TITLE_BOX
    : null;
  return {
    schemaVersion: 2,
    rendererVersion: APPROVED_BOARD_RENDERER_VERSION,
    format: "png",
    rasterization: "direct",
    rendererFingerprint,
    geometryHash: approvedTemplateFingerprint(template),
    aspectClass: suite.aspectClass,
    suiteId: suite.suiteId,
    templateId: template.id,
    templateVersion: template.version,
    scale,
    baseCanvas: { width: template.canvas.width, height: template.canvas.height },
    outputCanvas: {
      width: Math.round(template.canvas.width * scale),
      height: Math.round(template.canvas.height * scale),
    },
    background: { id: template.backgroundId },
    layerOrder: [...template.layerOrder],
    logo: {
      assetPath: template.logo.assetPath,
      left: Math.round(template.logo.left * scale),
      top: Math.round(template.logo.top * scale),
      width: Math.max(1, Math.round(template.logo.width * scale)),
      z: template.logo.z,
    },
    titleBox: titleBox ? {
      left: titleBox.left * scale,
      top: titleBox.top * scale,
      width: titleBox.width * scale,
      height: titleBox.height * scale,
      fontSize: titleBox.fontSize * scale,
      color: titleBox.color || "#27313a",
      align: titleBox.align || "right",
    } : null,
    slots: slots.map((slot, slotIndex) => {
      const renderedAssignment = renderedAssignments[slotIndex];
      if (!renderedAssignment || renderedAssignment.slotId !== slot.id) {
        throw new Error(`${template.id}: 슬롯 ${slot.id}의 실제 렌더 배치 기록이 없습니다.`);
      }
      if (renderedAssignment.contentHash !== renderInputHashes[slotIndex]) {
        throw new Error(`${template.id}: 슬롯 ${slot.id}의 목업 입력 해시가 실제 렌더 기록과 다릅니다.`);
      }
      return {
      slotId: slot.id,
      slotIndex,
      sourceSlideIndex: slides[slotIndex].index,
      contentHash: contentHashes[slotIndex],
      renderInputHash: renderInputHashes[slotIndex],
      ...(sourceFits[slotIndex] ? { sourceFit: sourceFits[slotIndex] } : {}),
      role: slot.role,
      layer: slot.role,
      z: slot.z,
      allowCanvasClip: slot.allowCanvasClip,
      baseGeometry: {
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        angle: slot.angle,
      },
      transformedCorners: approvedSlotPolygon(slot).map((point) => scaledPoint(point, scale)),
      shadow: resolveApprovedMockupShadow(template.kind, slot, scale),
      rasterPlacement: renderedAssignment.rasterPlacement,
    };
    }),
  };
}

function debugLine(point: Point, angle: number, canvas: { width: number; height: number }) {
  const radians = angle * Math.PI / 180;
  const reach = Math.hypot(canvas.width, canvas.height) * 1.5;
  const dx = Math.cos(radians) * reach;
  const dy = Math.sin(radians) * reach;
  return { x1: point.x - dx, y1: point.y - dy, x2: point.x + dx, y2: point.y + dy };
}

function n(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** A separate PNG proof; no guide pixel is ever added to the public render. */
export async function renderApprovedBoardDebugOverlay(
  bytes: Buffer,
  manifest: ApprovedBoardGeometryManifest,
) {
  const { width, height } = manifest.outputCanvas;
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png" || metadata.width !== width || metadata.height !== height) {
    throw new Error(`디버그 원본은 ${width}×${height} PNG여야 합니다.`);
  }
  const uiScale = manifest.scale;
  const elements = manifest.slots.map((slot) => {
    const [topLeft, topRight, bottomRight, bottomLeft] = slot.transformedCorners;
    const top = debugLine(topLeft, slot.baseGeometry.angle, manifest.outputCanvas);
    const bottom = debugLine(bottomLeft, slot.baseGeometry.angle, manifest.outputCanvas);
    const color = slot.role === "hero" ? "#ff2d55" : "#007aff";
    const labelX = Math.max(8 * uiScale, Math.min(width - 150 * uiScale, topLeft.x + 8 * uiScale));
    const labelY = Math.max(24 * uiScale, Math.min(height - 8 * uiScale, topLeft.y + 24 * uiScale));
    return `<g><line x1="${n(top.x1)}" y1="${n(top.y1)}" x2="${n(top.x2)}" y2="${n(top.y2)}" stroke="${color}" stroke-width="${n(1.5 * uiScale)}" stroke-dasharray="${n(9 * uiScale)} ${n(7 * uiScale)}" opacity=".55"/><line x1="${n(bottom.x1)}" y1="${n(bottom.y1)}" x2="${n(bottom.x2)}" y2="${n(bottom.y2)}" stroke="${color}" stroke-width="${n(1.5 * uiScale)}" stroke-dasharray="${n(9 * uiScale)} ${n(7 * uiScale)}" opacity=".55"/><polygon points="${[topLeft,topRight,bottomRight,bottomLeft].map((point)=>`${n(point.x)},${n(point.y)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${n(3 * uiScale)}"/><rect x="${n(labelX-5 * uiScale)}" y="${n(labelY-18 * uiScale)}" width="${n(142 * uiScale)}" height="${n(24 * uiScale)}" rx="${n(4 * uiScale)}" fill="#111827" fill-opacity=".9"/><text x="${n(labelX)}" y="${n(labelY)}" font-family="Arial, sans-serif" font-size="${n(15 * uiScale)}" font-weight="700" fill="#ffffff">SLOT ${slot.slotIndex+1} · SRC ${slot.sourceSlideIndex+1}</text></g>`;
  }).join("");
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${elements}</svg>`);
  return sharp(bytes).composite([{ input: svg, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/**
 * Renders one explicitly assigned approved board. Assignment order is the
 * resolved slot order; no random selection or filler slide is permitted.
 */
export async function renderAssignedApprovedBoard(input: {
  aspectClass: string;
  templateId: string;
  slides: readonly ApprovedMockupAssignedSlide[];
  title?: string | null;
  scale: ApprovedMockupRenderScale;
  /** Explicit render-only A4 padding. Omission preserves the original strict path. */
  a4SourceFit?: ApprovedBoardA4SourceFit;
  /** Absolute root of a hash-manifest-verified standalone renderer package. */
  runtimeRoot?: string;
}): Promise<ApprovedAssignedBoardRenderResult> {
  if (input.scale !== 0.5 && input.scale !== 1) {
    throw new Error("승인 목업 렌더 배율은 0.5 또는 1이어야 합니다.");
  }
  const { suite, template } = templateFor(input.aspectClass, input.templateId);
  const geometry = inspectApprovedTemplateGeometry(template);
  if (!geometry.passed) throw new Error(`${template.id}: ${geometry.errors.join("; ")}`);
  const rendererFingerprint = await approvedBoardRendererFingerprint(
    input.aspectClass,
    input.templateId,
    { runtimeRoot: input.runtimeRoot },
  );
  const { slots, contentHashes, renderInputHashes, sourceFits, renderSlides } =
    await validateAssignedSlides(suite, template, input.slides, input.a4SourceFit);
  const rendered = await renderApprovedMockup({ template, slides: renderSlides, title: input.title,
    scale: input.scale, outputFormat: "png", runtimeRoot: input.runtimeRoot });
  const verifiedAfterRender = await approvedBoardRendererFingerprint(
    input.aspectClass,
    input.templateId,
    { runtimeRoot: input.runtimeRoot },
  );
  if (verifiedAfterRender !== rendererFingerprint) {
    throw new Error("APPROVED_MOCKUP_RUNTIME_CHANGED_DURING_RENDER");
  }
  const manifest = manifestFor({ suite, template, slides: input.slides, slots, contentHashes,
    renderInputHashes, sourceFits,
    renderedAssignments: rendered.slotAssignments, scale: input.scale, rendererFingerprint });
  const debugBytes = await renderApprovedBoardDebugOverlay(rendered.bytes, manifest);
  return {
    ...rendered,
    outputName: rendered.outputName.replace(/\.jpe?g$/i, ".png"),
    format: "png",
    debugBytes,
    geometryHash: manifest.geometryHash,
    rendererFingerprint,
    manifest,
  };
}

export type ApprovedBoardGeometryComparison = Readonly<{
  passed: boolean;
  maxDeviationPx: number;
  errors: readonly string[];
}>;

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compares the 0.5 draft directly against the 1.0 render geometry proof. */
export function compareApprovedBoardDraftAndFinal(
  draft: ApprovedBoardGeometryManifest,
  final: ApprovedBoardGeometryManifest,
): ApprovedBoardGeometryComparison {
  const errors: string[] = [];
  let maxDeviationPx = 0;
  const compareScaled = (label: string, draftValue: number, finalValue: number) => {
    const deviation = Math.abs(draftValue * 2 - finalValue);
    if (!Number.isFinite(deviation)) errors.push(`${label}: 유효하지 않은 좌표`);
    else {
      maxDeviationPx = Math.max(maxDeviationPx, deviation);
      if (deviation > 1) errors.push(`${label}: 초안×2와 최종 좌표 편차 ${deviation.toFixed(4)}px`);
    }
  };
  if (draft.scale !== 0.5 || final.scale !== 1) errors.push("초안 배율 0.5와 최종 배율 1이 필요합니다.");
  for (const key of ["schemaVersion","rendererVersion","rendererFingerprint","geometryHash","aspectClass","suiteId","templateId","templateVersion"] as const) {
    if (draft[key] !== final[key]) errors.push(`${key}: 초안과 최종이 다릅니다.`);
  }
  if (!sameJson(draft.baseCanvas, final.baseCanvas)) errors.push("기준 캔버스가 다릅니다.");
  if (!sameJson(draft.background, final.background)) errors.push("배경 정의가 다릅니다.");
  if (!sameJson(draft.layerOrder, final.layerOrder)) errors.push("레이어 순서가 다릅니다.");
  if (draft.format !== "png" || final.format !== "png"
    || draft.rasterization !== "direct" || final.rasterization !== "direct") {
    errors.push("초안과 최종은 직접 PNG 렌더여야 합니다.");
  }
  compareScaled("canvas.width", draft.outputCanvas.width, final.outputCanvas.width);
  compareScaled("canvas.height", draft.outputCanvas.height, final.outputCanvas.height);
  for (const key of ["left","top","width"] as const) compareScaled(`logo.${key}`, draft.logo[key], final.logo[key]);
  if (draft.logo.assetPath !== final.logo.assetPath || draft.logo.z !== final.logo.z) errors.push("로고 에셋 또는 z-order가 다릅니다.");
  if (Boolean(draft.titleBox) !== Boolean(final.titleBox)) errors.push("제목 상자 유무가 다릅니다.");
  if (draft.titleBox && final.titleBox) {
    for (const key of ["left","top","width","height","fontSize"] as const) {
      compareScaled(`titleBox.${key}`, draft.titleBox[key], final.titleBox[key]);
    }
    if (draft.titleBox.color !== final.titleBox.color || draft.titleBox.align !== final.titleBox.align) errors.push("제목 상자 스타일이 다릅니다.");
  }
  if (draft.slots.length !== final.slots.length) errors.push("슬롯 수가 다릅니다.");
  for (const [slotIndex, draftSlot] of draft.slots.entries()) {
    const finalSlot = final.slots[slotIndex];
    if (!finalSlot) continue;
    for (const key of ["slotId","slotIndex","sourceSlideIndex","contentHash","renderInputHash","role","layer","z","allowCanvasClip"] as const) {
      if (draftSlot[key] !== finalSlot[key]) errors.push(`slot ${slotIndex + 1}/${key}: 초안과 최종이 다릅니다.`);
    }
    if (!sameJson(draftSlot.sourceFit, finalSlot.sourceFit)) {
      errors.push(`slot ${slotIndex + 1}: A4 원본 맞춤 영수증이 다릅니다.`);
    }
    if (!sameJson(draftSlot.baseGeometry, finalSlot.baseGeometry)) errors.push(`slot ${slotIndex + 1}: 기준 기하가 다릅니다.`);
    if (draftSlot.transformedCorners.length !== finalSlot.transformedCorners.length) errors.push(`slot ${slotIndex + 1}: 꼭짓점 수가 다릅니다.`);
    for (const [cornerIndex, point] of draftSlot.transformedCorners.entries()) {
      const finalPoint = finalSlot.transformedCorners[cornerIndex];
      if (!finalPoint) continue;
      compareScaled(`slot ${slotIndex + 1}/corner ${cornerIndex + 1}/x`, point.x, finalPoint.x);
      compareScaled(`slot ${slotIndex + 1}/corner ${cornerIndex + 1}/y`, point.y, finalPoint.y);
    }
    if (draftSlot.rasterPlacement.clipped !== finalSlot.rasterPlacement.clipped) {
      errors.push(`slot ${slotIndex + 1}: 초안과 최종의 캔버스 잘림 상태가 다릅니다.`);
    }
    // Compare the intended raster size and anchor. libvips may add one
    // antialias padding pixel on each side of a rotated bitmap; therefore its
    // derived rotated/visible extents are recorded above, but are not treated
    // as approved geometry. Logical corners remain the ≤1 px scale proof.
    for (const key of ["fittedWidth","fittedHeight","unclippedLeft","unclippedTop",
      "sourceLeft","sourceTop","destinationLeft","destinationTop"] as const) {
      compareScaled(`slot ${slotIndex + 1}/raster/${key}`,
        draftSlot.rasterPlacement[key], finalSlot.rasterPlacement[key]);
    }
    if (draftSlot.shadow.kind !== finalSlot.shadow.kind || draftSlot.shadow.layers.length !== finalSlot.shadow.layers.length) {
      errors.push(`slot ${slotIndex + 1}: 그림자 정의가 다릅니다.`);
      continue;
    }
    for (const [layerIndex, draftLayer] of draftSlot.shadow.layers.entries()) {
      const finalLayer = finalSlot.shadow.layers[layerIndex];
      for (const key of ["dx","dy","blur"] as const) {
        compareScaled(`slot ${slotIndex + 1}/shadow ${layerIndex + 1}/${key}`, draftLayer[key], finalLayer[key]);
      }
      for (const key of ["filter","opacity","color","surfaceColor","surfaceOpacity"] as const) {
        if (draftLayer[key] !== finalLayer[key]) errors.push(`slot ${slotIndex + 1}/shadow ${layerIndex + 1}/${key}: 초안과 최종이 다릅니다.`);
      }
    }
  }
  return { passed: errors.length === 0, maxDeviationPx, errors };
}
