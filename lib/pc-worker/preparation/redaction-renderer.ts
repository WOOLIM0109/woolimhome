import { createHash } from "node:crypto";
import sharp from "sharp";
import type { RedactionManualResolution, RedactionRect, RedactionRegion, RedactionState, RedactionUncertainty } from "./redaction-types.ts";
import { REDACTION_RULE_VERSION } from "./redaction-types.ts";

export const redactionHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const OPAQUE_COLOR = [238, 240, 243, 255] as const;
export function validRedactionRect(rect: RedactionRect): boolean {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1 + 1e-10 && rect.y + rect.height <= 1 + 1e-10;
}
export function containsRedactionRect(outer: RedactionRect, inner: RedactionRect) {
  const epsilon = 1e-9;
  return outer.x <= inner.x + epsilon && outer.y <= inner.y + epsilon
    && outer.x + outer.width >= inner.x + inner.width - epsilon
    && outer.y + outer.height >= inner.y + inner.height - epsilon;
}
export function redactionInputFingerprint(state: RedactionState) {
  return redactionHash(JSON.stringify({ workId: state.workId, buildId: state.buildId,
    sourceHash: state.sourceHash, slideContentHash: state.slideContentHash, imageHash: state.imageHash,
    ruleVersion: REDACTION_RULE_VERSION, width: state.width, height: state.height,
    candidates: state.candidates, warnings: state.warnings, uncertainties: state.uncertainties ?? [],
    regions: state.regions, exceptions: state.exceptions, review: state.review,
    manualResolutions: state.manualResolutions ?? [] }));
}
/** Shared canonical form with the local editor. No extracted text or paths. */
export function redactionManualEditFingerprint(state: Pick<RedactionState, "regions" | "exceptions" | "review">) {
  return redactionHash(JSON.stringify({
    regions: state.regions.map((r) => ({ id: r.id, ...(r.candidateId ? { candidateId: r.candidateId } : {}),
      rect: { x: r.rect.x, y: r.rect.y, width: r.rect.width, height: r.rect.height }, mode: r.mode })),
    exceptions: state.exceptions.map((e) => ({ candidateId: e.candidateId, actor: e.actor.trim(), reason: e.reason.trim() })),
    review: { reviewer: state.review.reviewer.trim(), originalInspected: state.review.originalInspected, layoutAcceptable: state.review.layoutAcceptable },
  }));
}
export function redactionUncertaintyFingerprint(item: RedactionUncertainty) {
  return redactionHash(JSON.stringify({ id: item.id, candidateId: item.candidateId, code: item.code,
    rect: { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height } }));
}
export function validManualRedactionResolution(state: RedactionState, resolution: RedactionManualResolution): boolean {
  const uncertainty = state.uncertainties?.find((entry) => entry.id === resolution.uncertaintyId);
  if (!uncertainty || !["TEXT_RENDER_BOUNDS_UNRESOLVED", "TEXT_GEOMETRY_UNRESOLVED", "IMAGE_GEOMETRY_UNRESOLVED"].includes(uncertainty.code)
    || resolution.inspectedAtActualSize !== true || resolution.actor?.trim() !== state.review.reviewer.trim()
    || !resolution.actor?.trim() || !resolution.reason?.trim() || resolution.reason.trim().length < 10
    || !Number.isSafeInteger(resolution.reviewedRevision) || resolution.reviewedRevision < 0 || resolution.reviewedRevision > state.revision
    || resolution.sourceHash !== state.sourceHash || resolution.slideContentHash !== state.slideContentHash || resolution.imageHash !== state.imageHash
    || resolution.uncertaintyHash !== redactionUncertaintyFingerprint(uncertainty)
    || resolution.editHash !== redactionManualEditFingerprint(state)) return false;
  if (resolution.decision === "non_sensitive_confirmed") return !resolution.regionId;
  if (resolution.decision !== "opaque_confirmed") return false;
  const region = state.regions.find((entry) => entry.id === resolution.regionId);
  return !!region && region.mode === "opaque" && region.candidateId === uncertainty.candidateId
    && containsRedactionRect(region.rect, uncertainty.rect);
}
export function hasFatalRedactionWarning(state: Pick<RedactionState, "warnings">): boolean {
  // Never infer that a located item accounts for every unknown item of the same warning code.
  return state.warnings.some((warning) => /TRUNCATED|INCOMPLETE|UNSUPPORTED|UNRESOLVED/.test(warning));
}
export function redactionHolds(state: RedactionState): string[] {
  const holds: string[] = [];
  if (state.ruleVersion !== REDACTION_RULE_VERSION) holds.push("REDACTION_RULE_CHANGED");
  if (!state.review.originalInspected || !state.review.reviewer.trim()) holds.push("ORIGINAL_REVIEW_REQUIRED");
  if (!state.review.layoutAcceptable) holds.push("REPLACEMENT_OR_LAYOUT_REVIEW_REQUIRED");
  // An arbitrary manual rectangle cannot prove that every unlocated item was covered.
  if (hasFatalRedactionWarning(state))
    holds.push("INCOMPLETE_DETECTION_REPLACE_OR_RECONVERT_REQUIRED");
  const validResolutions = (state.manualResolutions ?? []).filter((resolution) => validManualRedactionResolution(state, resolution));
  for (const uncertainty of state.uncertainties ?? []) {
    if (!validResolutions.some((entry) => entry.uncertaintyId === uncertainty.id)) holds.push(`MANUAL_GEOMETRY_REVIEW_REQUIRED:${uncertainty.id}`);
  }
  for (const candidate of state.candidates) {
    const uncertainties = (state.uncertainties ?? []).filter((entry) => entry.candidateId === candidate.id);
    if (uncertainties.length && uncertainties.every((uncertainty) => validResolutions.some((entry) =>
      entry.uncertaintyId === uncertainty.id && entry.decision === "non_sensitive_confirmed"))) continue;
    if (state.exceptions.some((e) => e.candidateId === candidate.id && e.actor.trim() && e.reason.trim())) continue;
    const covered = state.regions.some((r) => r.candidateId === candidate.id
      && containsRedactionRect(r.rect, candidate.rect) && (!candidate.required || r.mode === "opaque"));
    if (!covered) holds.push(`CANDIDATE_UNRESOLVED:${candidate.id}`);
  }
  return holds;
}
export function pixelRedactionRect(rect: RedactionRect, width: number, height: number) {
  if (!validRedactionRect(rect)) throw new Error("INVALID_REDACTION_RECT");
  const padding = Math.max(2, Math.ceil(Math.max(width, height) * 6 / 2400));
  const left = Math.max(0, Math.floor(rect.x * width) - padding);
  const top = Math.max(0, Math.floor(rect.y * height) - padding);
  const right = Math.min(width, Math.ceil((rect.x + rect.width) * width) + padding);
  const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height) + padding);
  return { left, top, width: right - left, height: bottom - top };
}
export function assertRedactionComplexity(regions: RedactionRegion[]) {
  if (regions.length > 500 || regions.filter((r) => r.mode === "blur").length > 20
    || regions.reduce((area, r) => area + r.rect.width * r.rect.height, 0) > 8) {
    throw new Error("REDACTION_COMPLEXITY_LIMIT");
  }
}
export async function decodeRedactionPng(png: Buffer) {
  if (png.length > 100 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("INVALID_REDACTION_PNG");
  const { data, info } = await sharp(png, { limitInputPixels: 20_000_000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width < 1 || info.height < 1) throw new Error("INVALID_REDACTION_IMAGE");
  // A transparent source can hide unredacted RGB underneath; require opaque conversion output.
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw new Error("TRANSPARENT_SOURCE_REQUIRES_RECONVERSION");
  return { data, width: info.width, height: info.height };
}
export function assertFlatRedactionPng(png: Buffer) {
  let offset = 8;
  const allowed = new Set(["IHDR", "IDAT", "IEND", "pHYs"]);
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    if (!allowed.has(type) || offset + length + 12 > png.length) throw new Error("REDACTION_METADATA_NOT_STRIPPED");
    offset += length + 12;
    if (type === "IEND") { if (offset !== png.length) throw new Error("REDACTION_TRAILING_DATA"); return; }
  }
  throw new Error("INVALID_REDACTION_PNG");
}
/** No filesystem/network side effects; an opaque mask never samples confidential pixels. */
export async function renderRedactedPng(source: Buffer, state: RedactionState) {
  assertRedactionComplexity(state.regions);
  const holds = redactionHolds(state);
  if (holds.length) throw new Error(`REDACTION_REVIEW_REQUIRED: ${holds.join(",")}`);
  if (redactionHash(source) !== state.imageHash) throw new Error("REDACTION_SOURCE_HASH_MISMATCH");
  const original = await decodeRedactionPng(source);
  const { width, height } = original;
  if (width !== state.width || height !== state.height) throw new Error("REDACTION_DIMENSION_MISMATCH");
  const output = Buffer.from(original.data), touched = new Uint8Array(width * height);
  const ordered = [...state.regions].sort((a, b) => Number(a.mode === "opaque") - Number(b.mode === "opaque"));
  for (const region of ordered) {
    if (!["opaque", "blur"].includes(region.mode)) throw new Error("INVALID_REDACTION_MODE");
    const box = pixelRedactionRect(region.rect, width, height);
    const blurred = region.mode === "blur" ? await sharp(original.data, { raw: { width, height, channels: 4 } })
      .extract(box).blur(Math.max(8, Math.max(width, height) / 100)).raw().toBuffer() : null;
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      const pixel = (box.top + y) * width + box.left + x, target = pixel * 4;
      touched[pixel] = 1;
      for (let c = 0; c < 4; c++) output[target + c] = blurred ? blurred[(y * box.width + x) * 4 + c] : OPAQUE_COLOR[c];
    }
  }
  const png = await sharp(output, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  assertFlatRedactionPng(png);
  const decoded = await decodeRedactionPng(png);
  for (let p = 0; p < touched.length; p++) if (!touched[p]) {
    for (let c = 0; c < 4; c++) if (decoded.data[p * 4 + c] !== original.data[p * 4 + c]) throw new Error("REDACTION_CHANGED_OUTSIDE_REGIONS");
  }
  // Also verify exact opaque pixels. Pixel changes alone do not establish privacy.
  for (const region of state.regions.filter((r: RedactionRegion) => r.mode === "opaque")) {
    const box = pixelRedactionRect(region.rect, width, height);
    for (let y = box.top; y < box.top + box.height; y++) for (let x = box.left; x < box.left + box.width; x++) {
      for (let c = 0; c < 4; c++) if (decoded.data[(y * width + x) * 4 + c] !== OPAQUE_COLOR[c]) throw new Error("OPAQUE_MASK_VERIFICATION_FAILED");
    }
  }
  return { png, width, height, sha256: redactionHash(png), inputFingerprint: redactionInputFingerprint(state),
    checks: { outsidePreserved: true, requiredOpaque: true, metadataStripped: true } as const };
}
