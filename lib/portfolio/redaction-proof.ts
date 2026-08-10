import { createHash } from "node:crypto";
import type { SensitiveRegion } from "./visual-review";
import {
  redactableRegions,
  inspectLocalRedactionSlideSafety,
  LOCAL_REDACTION_MANIFEST_METHOD,
  validateLocalRedactionManifest,
  type LocalRedactionManifest,
  type LocalRedactionSlide,
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
  version: 2;
  method: typeof LOCAL_REDACTION_MANIFEST_METHOD;
  verified: true;
  sourceFingerprint: string;
  manifestHash: string;
  slides: PortfolioSlideRedactionProof[];
};

export type LocalRedactionVerification = {
  verified: boolean;
  regionCount: number;
  coverage: number;
  blockedSlideIndexes: number[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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
    .flatMap((slide) => redactableRegions(slide.regions)) as SensitiveRegion[];
}

function normalizedSelectedIndexes(indexes: number[]) {
  if (!indexes.length
    || indexes.some((index) => !Number.isInteger(index) || index < 0)
    || new Set(indexes).size !== indexes.length) return null;
  return [...indexes].sort((left, right) => left - right);
}

export function verifyLocalRedactionSelection(
  manifest: LocalRedactionManifest,
  selectedSlideIndexes: number[],
): LocalRedactionVerification {
  const selected = normalizedSelectedIndexes(selectedSlideIndexes);
  if (!selected) {
    return { verified: false, regionCount: 0, coverage: 0, blockedSlideIndexes: [] };
  }
  const slidesByIndex = new Map(manifest.slides.map((slide) => [slide.slideIndex, slide]));
  let regionCount = 0;
  let coverage = 0;
  const blockedSlideIndexes: number[] = [];
  selected.forEach((slideIndex) => {
    const slide = slidesByIndex.get(slideIndex);
    if (!slide) {
      blockedSlideIndexes.push(slideIndex);
      return;
    }
    const safety = inspectLocalRedactionSlideSafety(slide);
    regionCount += redactableRegions(slide.regions).length;
    coverage += safety.unionCoverage;
    if (!safety.safeForAutomaticDesign) blockedSlideIndexes.push(slideIndex);
  });
  return {
    verified: blockedSlideIndexes.length === 0,
    regionCount,
    coverage: coverage / selected.length,
    blockedSlideIndexes,
  };
}

export function isPortfolioSlideRedactionProofForManifest(
  proof: PortfolioSlideRedactionProof,
  manifestSlide: LocalRedactionSlide,
) {
  if (proof.slideIndex !== manifestSlide.slideIndex
    || !Number.isInteger(proof.regionCount)
    // 실제로 가린 개수와 비교합니다. 정책에서 제외한 영역은 세지 않습니다.
    || proof.regionCount !== redactableRegions(manifestSlide.regions).length
    || !Number.isFinite(proof.changedPixelRatio)
    || proof.changedPixelRatio < 0
    || proof.changedPixelRatio > 1
    || !SHA256_PATTERN.test(proof.sourceHash)
    || !SHA256_PATTERN.test(proof.redactedHash)
    || !inspectLocalRedactionSlideSafety(manifestSlide).safeForAutomaticDesign) {
    return false;
  }
  if (manifestSlide.regions.length === 0) {
    return proof.changedPixelRatio === 0 && proof.sourceHash === proof.redactedHash;
  }
  return proof.changedPixelRatio > 0 && proof.sourceHash !== proof.redactedHash;
}

export function createLocalRedactionProof(input: {
  manifest: LocalRedactionManifest;
  sourceFingerprint: string;
  selectedSlideIndexes: number[];
  slides: PortfolioSlideRedactionProof[];
}): PortfolioRedactionProof {
  const selected = normalizedSelectedIndexes(input.selectedSlideIndexes);
  const proofs = [...input.slides].sort((left, right) => left.slideIndex - right.slideIndex);
  const manifestSlides = new Map(input.manifest.slides.map((slide) => [slide.slideIndex, slide]));
  const verification = verifyLocalRedactionSelection(input.manifest, input.selectedSlideIndexes);
  const valid = selected !== null
    && verification.verified
    && SHA256_PATTERN.test(input.sourceFingerprint)
    && proofs.length === selected.length
    && proofs.every((proof, position) => {
      const slideIndex = selected[position];
      const manifestSlide = manifestSlides.get(slideIndex);
      return proof.slideIndex === slideIndex
        && Boolean(manifestSlide)
        && isPortfolioSlideRedactionProofForManifest(proof, manifestSlide as LocalRedactionSlide);
    });
  if (!valid) {
    throw new Error("로컬 선택 블러 증명이 manifest v2와 일치하지 않아 포트폴리오 디자인을 저장하지 않습니다.");
  }
  return {
    version: 2,
    method: LOCAL_REDACTION_MANIFEST_METHOD,
    verified: true,
    sourceFingerprint: input.sourceFingerprint,
    manifestHash: localRedactionManifestHash(input.manifest),
    slides: proofs,
  };
}

/**
 * Checks the current proof envelope and rendered-index binding without trusting
 * it as a redaction result. Source-state validation must additionally call
 * isVerifiedPortfolioRedactionProof with the normalized manifest.
 */
export function isCurrentPortfolioRedactionProof(
  value: unknown,
  sourceFingerprint: string,
  selectedSlideIndexes: number[],
): value is PortfolioRedactionProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Partial<PortfolioRedactionProof>;
  if (proof.version !== 2
    || proof.method !== LOCAL_REDACTION_MANIFEST_METHOD
    || proof.verified !== true
    || proof.sourceFingerprint !== sourceFingerprint
    || !SHA256_PATTERN.test(String(proof.manifestHash || ""))
    || !Array.isArray(proof.slides)) {
    return false;
  }
  const selected = normalizedSelectedIndexes(selectedSlideIndexes);
  if (!selected) return false;
  const slides = [...proof.slides].sort((left, right) => left.slideIndex - right.slideIndex);
  return slides.length === selected.length
    && new Set(slides.map((slide) => slide.slideIndex)).size === slides.length
    && slides.every((slide, position) => (
      slide.slideIndex === selected[position]
      && Number.isInteger(slide.regionCount)
      && slide.regionCount >= 0
      && Number.isFinite(slide.changedPixelRatio)
      && slide.changedPixelRatio >= 0
      && slide.changedPixelRatio <= 1
      && SHA256_PATTERN.test(slide.sourceHash)
      && SHA256_PATTERN.test(slide.redactedHash)
      && (slide.regionCount === 0
        ? slide.changedPixelRatio === 0 && slide.sourceHash === slide.redactedHash
        : slide.changedPixelRatio > 0 && slide.sourceHash !== slide.redactedHash)
    ));
}

export function isVerifiedPortfolioRedactionProof(
  value: unknown,
  sourceFingerprint: string,
  selectedSlideIndexes: number[],
  manifest: LocalRedactionManifest,
): value is PortfolioRedactionProof {
  if (!isCurrentPortfolioRedactionProof(value, sourceFingerprint, selectedSlideIndexes)) return false;
  if (value.manifestHash !== localRedactionManifestHash(manifest)) return false;
  const verification = verifyLocalRedactionSelection(manifest, selectedSlideIndexes);
  if (!verification.verified) return false;
  const manifestSlides = new Map(manifest.slides.map((slide) => [slide.slideIndex, slide]));
  return value.slides.every((proof) => {
    const manifestSlide = manifestSlides.get(proof.slideIndex);
    return Boolean(manifestSlide)
      && isPortfolioSlideRedactionProofForManifest(proof, manifestSlide as LocalRedactionSlide);
  });
}
