import { createHash } from "node:crypto";
import sharp from "sharp";

export type A4SourceAspectClass = "a4_landscape" | "a4_portrait";
export type A4SourceKind = "powerpoint_a4_preset" | "custom_preview";
export type A4SourceFitInput = {
  buffer: Buffer;
  /** Inspected PowerPoint dimensions in points, not PNG pixels. */
  sourceWidth: number;
  sourceHeight: number;
  aspectClass: A4SourceAspectClass;
  /** Required explicitly. custom_preview does not confer any approval. */
  sourceKind: A4SourceKind;
};
export type A4SourceFitReceipt = {
  version: 1;
  sourceKind: A4SourceKind;
  sourceHash: string;
  resultHash: string;
  sourceWidth: number;
  sourceHeight: number;
  sourcePixelWidth: number;
  sourcePixelHeight: number;
  targetWidth: number;
  targetHeight: number;
  padding: { top: number; right: number; bottom: number; left: number };
  scale: 1;
  crop: false;
  targetAspectClass: A4SourceAspectClass;
};

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 4096;
const MAX_POINTS = 14_400;
const POINT_EPSILON = 1e-5;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fail = (code: string): never => { throw new Error(`A4_SOURCE_FIT_${code}`); };

/** Bound the decoder before decompression; APNG and trailing payloads are never accepted. */
function inspectPng(bytes: Buffer, stripped = false) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail("PNG_REQUIRED");
  let offset = 8, width = 0, height = 0, imageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail("INVALID_PNG");
    if (["acTL", "fcTL", "fdAT"].includes(type)) fail("SINGLE_FRAME_REQUIRED");
    // Stripping orientation or colour transforms could change the visible result even
    // when raw samples match. Require reconversion rather than rotate/recolour pixels.
    if (type === "eXIf") fail("ORIENTATION_METADATA_REQUIRES_RECONVERSION");
    if (["iCCP", "gAMA", "cHRM", "cICP", "mDCV", "cLLI"].includes(type)) fail("COLOR_METADATA_REQUIRES_RECONVERSION");
    // Canonical sRGB is the untagged output's interpretation too; no transform is needed.
    if (type === "sRGB" && (length !== 1 || bytes[offset + 8] > 3)) fail("INVALID_SRGB_DECLARATION");
    if (stripped && !["IHDR", "IDAT", "IEND"].includes(type)) fail("METADATA_NOT_STRIPPED");
    if (offset === 8 && type !== "IHDR") fail("INVALID_PNG");
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) fail("INVALID_PNG");
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > MAX_EDGE || height > MAX_EDGE) fail("PIXEL_SIZE_LIMIT");
      // Reject high-depth inputs instead of silently reducing their sample precision.
      if (bytes[offset + 16] !== 8 || ![0, 2, 3, 4, 6].includes(bytes[offset + 17])) fail("EIGHT_BIT_PNG_REQUIRED");
    }
    if (type === "IDAT") imageData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !imageData) fail("INVALID_PNG");
      return { width, height };
    }
    offset = end;
  }
  return fail("INVALID_PNG");
}

async function decodePixels(bytes: Buffer) {
  try {
    // Profiles/colour transforms were rejected before decoding; never apply an implicit ICC conversion.
    return await sharp(bytes, { limitInputPixels: MAX_EDGE * MAX_EDGE, failOn: "warning", ignoreIcc: true })
      .toColourspace("srgb").ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    return fail("PNG_DECODE_FAILED");
  }
}

/** Strip encoder-added ancillary chunks (including default pHYs) from a fresh RGBA encode. */
function stripEncodedMetadata(encoded: Buffer): Buffer {
  inspectPng(encoded);
  const chunks = [encoded.subarray(0, 8)];
  for (let offset = 8; offset < encoded.length;) {
    const end = offset + encoded.readUInt32BE(offset) + 12;
    if (["IHDR", "IDAT", "IEND"].includes(encoded.toString("ascii", offset + 4, offset + 8))) chunks.push(encoded.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}

/**
 * Memory-only A4 fit, not a blur/privacy/visual approval. No resize, crop, rotation, or
 * source-pixel edits: only one outer canvas dimension can grow. An odd extra pixel
 * goes on the bottom/right. Transparent sources must be reconverted, not flattened.
 * eXIf/ICC/gamma/chromaticity/HDR metadata also require reconversion. Canonical sRGB,
 * pHYs and non-rendering text metadata may be stripped. Input and output are <=12 MiB.
 */
export async function padA4SourceSlide(input: A4SourceFitInput): Promise<{ bytes: Buffer; receipt: A4SourceFitReceipt }> {
  if (!input || !Buffer.isBuffer(input.buffer) || input.buffer.length > MAX_BYTES) fail("INPUT_SIZE_OR_TYPE");
  const { sourceWidth, sourceHeight, aspectClass, sourceKind } = input;
  if (![sourceWidth, sourceHeight].every(n => Number.isFinite(n) && n > 0 && n <= MAX_POINTS)) fail("INVALID_POINT_SIZE");
  if (!["a4_landscape", "a4_portrait"].includes(aspectClass)) fail("INVALID_ASPECT_CLASS");
  if (!["powerpoint_a4_preset", "custom_preview"].includes(sourceKind)) fail("EXPLICIT_SOURCE_KIND_REQUIRED");
  const landscape = aspectClass === "a4_landscape";
  const oriented = (width: number, height: number) => landscape ? width > height : height > width;
  if (!oriented(sourceWidth, sourceHeight)) fail("WRONG_ORIENTATION");
  const targetRatio = landscape ? Math.SQRT2 : 1 / Math.SQRT2;
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceKind === "powerpoint_a4_preset") {
    if (Math.abs(sourceWidth - (landscape ? 780 : 540)) > POINT_EPSILON
      || Math.abs(sourceHeight - (landscape ? 540 : 780)) > POINT_EPSILON) fail("PPT_A4_PRESET_REQUIRED");
  } else if (Math.abs(sourceRatio / targetRatio - 1) > 0.03 + Number.EPSILON) fail("CUSTOM_RATIO_OUTSIDE_PREVIEW_LIMIT");

  // Detach caller-owned bytes before the first await, binding the receipt to exactly this input.
  const source = Buffer.from(input.buffer), { width, height } = inspectPng(source);
  if (!oriented(width, height)) fail("WRONG_ORIENTATION");
  // Match the inspected point ratio on the short axis, allowing at most one raster rounding pixel.
  const shortAxisError = landscape ? Math.abs(height - width / sourceRatio) : Math.abs(width - height * sourceRatio);
  if (shortAxisError > 1 + 1e-9) fail("SOURCE_PIXEL_RATIO_MISMATCH");
  const targetWidth = width / height < targetRatio ? Math.ceil(height * targetRatio) : width;
  const targetHeight = width / height > targetRatio ? Math.ceil(width / targetRatio) : height;
  if (targetWidth > MAX_EDGE || targetHeight > MAX_EDGE) fail("TARGET_PIXEL_SIZE_LIMIT");
  const left = Math.floor((targetWidth - width) / 2), top = Math.floor((targetHeight - height) / 2);
  const padding = { top, right: targetWidth - width - left, bottom: targetHeight - height - top, left };
  const decoded = await decodePixels(source);
  if (decoded.info.width !== width || decoded.info.height !== height || decoded.info.channels !== 4) fail("DECODE_DIMENSION_MISMATCH");
  for (let i = 3; i < decoded.data.length; i += 4) if (decoded.data[i] !== 255) fail("OPAQUE_SOURCE_REQUIRED");

  const pixels = Buffer.alloc(targetWidth * targetHeight * 4, 255);
  for (let y = 0; y < height; y++) {
    decoded.data.copy(pixels, ((y + top) * targetWidth + left) * 4, y * width * 4, (y + 1) * width * 4);
  }
  const bytes = stripEncodedMetadata(await sharp(pixels, { raw: { width: targetWidth, height: targetHeight, channels: 4 } })
    .png({ compressionLevel: 9, palette: false }).toBuffer());
  if (bytes.length > MAX_BYTES) fail("OUTPUT_SIZE_LIMIT");
  const outputSize = inspectPng(bytes, true), verified = await decodePixels(bytes);
  if (outputSize.width !== targetWidth || outputSize.height !== targetHeight || !verified.data.equals(pixels)) fail("PIXEL_PRESERVATION_FAILED");
  return { bytes, receipt: { version: 1, sourceKind, sourceHash: hash(source), resultHash: hash(bytes),
    sourceWidth, sourceHeight, sourcePixelWidth: width, sourcePixelHeight: height, targetWidth, targetHeight,
    padding, scale: 1, crop: false, targetAspectClass: aspectClass } };
}
