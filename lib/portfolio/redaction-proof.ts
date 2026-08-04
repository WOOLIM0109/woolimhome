import { createHash } from "node:crypto";
import type { SensitiveRegion } from "./visual-review";
import {
  LOCAL_REDACTION_MANIFEST_METHOD,
  validateLocalRedactionManifest,
  type LocalRedactionManifest,
} from "../pc-worker/redaction-manifest.ts";

export {
  LOCAL_REDACTION_MANIFEST_METHOD,
  LOCAL_REDACTION_MANIFEST_VERSION,
  type LocalRedactionManifest,
} from "../pc-worker/redaction-manifest.ts";

export type PortfolioSlideRedactionProof = {
  slideIndex: number;
  sourceHash: string;
  redactedHash: string;
  regionCount: number;
  changedPixelRatio: number;
};

export type PortfolioRedactionProof = {
  version: 1;
  method: typeof LOCAL_REDACTION_MANIFEST_METHOD;
  verified: true;
  sourceFingerprint: string;
  manifestHash: string;
  slides: PortfolioSlideRedactionProof[];
};

export function parseLocalRedactionManifest(
  value: unknown,
  expectedSlideCount: number,
): LocalRedactionManifest | null {
  const result = validateLocalRedactionManifest(value, expectedSlideCount);
  return result.ok ? result.manifest : null;
}

export function localRedactionManifestHash(manifest: LocalRedactionManifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function localRedactionRegions(
  manifest: LocalRedactionManifest,
  indexes: number[],
) {
  const selected = new Set(indexes);
  return manifest.slides
    .filter((slide) => selected.has(slide.slideIndex))
    .flatMap((slide) => slide.regions) as SensitiveRegion[];
}

export function createLocalRedactionProof(input: {
  manifest: LocalRedactionManifest;
  sourceFingerprint: string;
  selectedSlideIndexes: number[];
  slides: PortfolioSlideRedactionProof[];
}): PortfolioRedactionProof {
  const selected = [...new Set(input.selectedSlideIndexes)].sort((left, right) => left - right);
  const proofs = [...input.slides].sort((left, right) => left.slideIndex - right.slideIndex);
  const manifestIndexes = new Set(input.manifest.slides.map((slide) => slide.slideIndex));
  const proofIndexes = proofs.map((proof) => proof.slideIndex);
  const valid = selected.length > 0
    && /^[a-f0-9]{64}$/i.test(input.sourceFingerprint)
    && proofIndexes.length === selected.length
    && selected.every((index, position) => (
      manifestIndexes.has(index)
      && proofIndexes[position] === index
      && proofs[position].regionCount > 0
      && Number.isFinite(proofs[position].changedPixelRatio)
      && proofs[position].changedPixelRatio > 0
      && /^[a-f0-9]{64}$/i.test(proofs[position].sourceHash)
      && /^[a-f0-9]{64}$/i.test(proofs[position].redactedHash)
      && proofs[position].sourceHash !== proofs[position].redactedHash
    ));
  if (!valid) {
    throw new Error("로컬 기밀 블러 증명이 완전하지 않아 포트폴리오 디자인을 저장하지 않았습니다.");
  }
  return {
    version: 1,
    method: LOCAL_REDACTION_MANIFEST_METHOD,
    verified: true,
    sourceFingerprint: input.sourceFingerprint,
    manifestHash: localRedactionManifestHash(input.manifest),
    slides: proofs,
  };
}

export function isVerifiedPortfolioRedactionProof(
  value: unknown,
  sourceFingerprint: string,
  selectedSlideIndexes: number[],
): value is PortfolioRedactionProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Partial<PortfolioRedactionProof>;
  if (proof.version !== 1
    || proof.method !== LOCAL_REDACTION_MANIFEST_METHOD
    || proof.verified !== true
    || proof.sourceFingerprint !== sourceFingerprint
    || !/^[a-f0-9]{64}$/i.test(String(proof.manifestHash || ""))
    || !Array.isArray(proof.slides)) {
    return false;
  }
  const selectedInputValid = selectedSlideIndexes.length > 0
    && selectedSlideIndexes.every((index) => Number.isInteger(index) && index >= 0)
    && new Set(selectedSlideIndexes).size === selectedSlideIndexes.length;
  if (!selectedInputValid) return false;
  const selected = [...selectedSlideIndexes].sort((left, right) => left - right);
  const slides = [...proof.slides].sort((left, right) => left.slideIndex - right.slideIndex);
  const byIndex = new Map(slides.map((slide) => [slide.slideIndex, slide]));
  const everyStoredProofValid = byIndex.size === slides.length && slides.every((slide) => (
    Number.isInteger(slide.slideIndex)
    && slide.slideIndex >= 0
    && Number.isInteger(slide.regionCount)
    && slide.regionCount > 0
    && Number.isFinite(slide.changedPixelRatio)
    && slide.changedPixelRatio > 0
    && /^[a-f0-9]{64}$/i.test(slide.sourceHash)
    && /^[a-f0-9]{64}$/i.test(slide.redactedHash)
    && slide.sourceHash !== slide.redactedHash
  ));
  return everyStoredProofValid
    && slides.length === selected.length
    && slides.every((slide, position) => slide.slideIndex === selected[position]);
}
