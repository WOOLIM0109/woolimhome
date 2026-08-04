import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortfolioSourceFingerprint,
  PORTFOLIO_RULE_VERSION,
  validatePortfolioPublicationMetadata,
  validatePortfolioSourceState,
} from "./portfolio-rules.ts";
import { localRedactionManifestHash } from "../portfolio/redaction-proof.ts";

const LOCAL_REDACTION_MANIFEST = {
  version: 1,
  method: "powerpoint_com_shapes_v1",
  slideCount: 5,
  slides: Array.from({ length: 5 }, (_, slideIndex) => ({
    slideIndex,
    sourceSlideNumber: slideIndex + 1,
    regions: [{
      slideIndex,
      type: "body_text",
      label: "local_body_text",
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.2,
    }],
  })),
};
const MANIFEST_HASH = localRedactionManifestHash(LOCAL_REDACTION_MANIFEST);

const CONVERSION = {
  status: "completed",
  result: {
    bucket: "slides",
    slidePaths: ["1.png", "2.png", "3.png", "4.png", "5.png"],
    localRedactionManifest: LOCAL_REDACTION_MANIFEST,
  },
  updated_at: "2026-08-04T00:00:00.000Z",
};
const SOURCE_FINGERPRINT = createPortfolioSourceFingerprint({
  bucket: CONVERSION.result.bucket,
  slidePaths: CONVERSION.result.slidePaths,
  conversionUpdatedAt: CONVERSION.updated_at,
});
const DRAFT = {
  status: "completed",
  result: {
    sourceFingerprint: SOURCE_FINGERPRINT,
    portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
  },
};

function redactionProof(indexes) {
  return {
    version: 1,
    method: "powerpoint_com_shapes_v1",
    verified: true,
    sourceFingerprint: SOURCE_FINGERPRINT,
    manifestHash: MANIFEST_HASH,
    slides: indexes.map((slideIndex) => ({
      slideIndex,
      sourceHash: ((slideIndex % 8) + 1).toString(16).repeat(64),
      redactedHash: ((slideIndex % 8) + 8).toString(16).repeat(64),
      regionCount: 1,
      changedPixelRatio: 0.1,
    })),
  };
}

function bodyHtml(figureCount) {
  return Array.from({ length: figureCount }, (_, index) => (
    `<p>목업 ${index + 1} 설명입니다.</p><figure><img src="/${index}.jpg"><figcaption>설명</figcaption></figure>`
  )).join("<h2>다음 구성</h2>");
}

function portfolioMetadata(mode, boardSizes, redactionStatus = "verified") {
  const bodyAssets = [];
  let slideIndex = 0;
  for (const boardSize of boardSizes) {
    bodyAssets.push({
      kind: "body_image",
      url: `/${bodyAssets.length}.jpg`,
      slideIndexes: Array.from({ length: boardSize }, () => slideIndex++),
    });
  }
  const selectedSlideIndexes = bodyAssets.flatMap((asset) => asset.slideIndexes);
  return {
    portfolioSourceFingerprint: SOURCE_FINGERPRINT,
    portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
    generated: { bodyHtml: bodyHtml(boardSizes.length) },
    portfolioAssets: [{ kind: "thumbnail", slideIndexes: [0] }, ...bodyAssets],
    redactionProof: redactionProof(selectedSlideIndexes),
    portfolioMockup: {
      mode,
      bodyBoardCount: boardSizes.length,
      selectedSlideIndexes,
      redactionStatus,
    },
  };
}

test("accepts a verified short portfolio with four body boards", () => {
  assert.deepEqual(validatePortfolioPublicationMetadata(
    portfolioMetadata("short_psd", [2, 1, 1, 1]),
  ), []);
});

test("accepts only the completed mockup job for the same source fingerprint", () => {
  const metadata = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  assert.deepEqual(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, CONVERSION, DRAFT), []);
  assert.ok(validatePortfolioSourceState(metadata, {
    status: "queued",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, CONVERSION, DRAFT).length > 0);
  assert.ok(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: "b".repeat(64), redactionProof: metadata.redactionProof },
  }, CONVERSION, DRAFT).length > 0);
  assert.ok(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, { ...CONVERSION, updated_at: "2026-08-04T00:01:00.000Z" }, DRAFT).length > 0);
  assert.ok(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, CONVERSION, { status: "failed", result: {} }).some((issue) => issue.includes("글쓰기")));
});

test("blocks portfolios produced by an older template or privacy rule version", () => {
  const metadata = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  metadata.portfolioRuleVersion = "legacy-rule";
  assert.ok(validatePortfolioPublicationMetadata(metadata)
    .some((issue) => issue.includes("현재 포트폴리오 템플릿·기밀 규칙")));
  assert.ok(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, CONVERSION, DRAFT).some((issue) => issue.includes("규칙 버전")));
});

test("accepts a verified 20-page long portfolio with three complete six-slide boards", () => {
  assert.deepEqual(validatePortfolioPublicationMetadata(
    portfolioMetadata("six_grid", [6, 6, 6]),
  ), []);
});

test("blocks publication when blur verification or a required board is missing", () => {
  const metadata = portfolioMetadata("six_grid", [6, 6, 6], "blocked");
  metadata.generated.bodyHtml = bodyHtml(2);
  const issues = validatePortfolioPublicationMetadata(metadata);
  assert.ok(issues.some((issue) => issue.includes("기밀 블러")));
  assert.ok(issues.some((issue) => issue.includes("3개 미만")));
});

test("does not trust an invalid one-board count for a long portfolio", () => {
  const metadata = portfolioMetadata("six_grid", [6]);
  metadata.generated.bodyHtml = bodyHtml(3);
  const issues = validatePortfolioPublicationMetadata(metadata);
  assert.ok(issues.some((issue) => issue.includes("3~5장")));
});

test("blocks repeated or incomplete long-board slide indexes", () => {
  const metadata = portfolioMetadata("six_grid", [6, 6, 6]);
  metadata.portfolioAssets[2].slideIndexes[5] = metadata.portfolioAssets[1].slideIndexes[0];
  const issues = validatePortfolioPublicationMetadata(metadata);
  assert.ok(issues.some((issue) => issue.includes("고유 인덱스")));
  assert.ok(issues.some((issue) => issue.includes("선정 장표 기록")));
});

test("does not trust verified text without a source-bound local redaction proof", () => {
  const metadata = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  delete metadata.redactionProof;
  const issues = validatePortfolioPublicationMetadata(metadata);
  assert.ok(issues.some((issue) => issue.includes("로컬 기밀 블러 증명")));
});

test("binds the stored proof to the normalized conversion redaction manifest", () => {
  const metadata = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  const changedConversion = structuredClone(CONVERSION);
  changedConversion.result.localRedactionManifest.slides[0].regions[0].x = 0.2;
  const issues = validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, changedConversion, DRAFT);
  assert.ok(issues.some((issue) => issue.includes("현재 변환 결과의 로컬 좌표")));

  const untrustedExtras = structuredClone(CONVERSION);
  untrustedExtras.result.localRedactionManifest.untrusted = "ignored";
  assert.deepEqual(validatePortfolioSourceState(metadata, {
    status: "completed",
    result: { sourceFingerprint: SOURCE_FINGERPRINT, redactionProof: metadata.redactionProof },
  }, untrustedExtras, DRAFT), []);
});

test("requires the proof to match every rendered asset including the thumbnail exactly", () => {
  const missingThumbnailProof = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  missingThumbnailProof.portfolioAssets[0].slideIndexes = [9];
  assert.ok(validatePortfolioPublicationMetadata(missingThumbnailProof)
    .some((issue) => issue.includes("로컬 기밀 블러 증명")));

  const extraProof = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  extraProof.redactionProof.slides.push({
    slideIndex: 9,
    sourceHash: "e".repeat(64),
    redactedHash: "f".repeat(64),
    regionCount: 1,
    changedPixelRatio: 0.1,
  });
  assert.ok(validatePortfolioPublicationMetadata(extraProof)
    .some((issue) => issue.includes("로컬 기밀 블러 증명")));
});

test("rejects empty selected indexes, proof sets, and body asset indexes", () => {
  const emptySelected = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  emptySelected.portfolioMockup.selectedSlideIndexes = [];
  assert.ok(validatePortfolioPublicationMetadata(emptySelected)
    .some((issue) => issue.includes("선정 장표 기록이 비어")));

  const emptyProof = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  emptyProof.redactionProof.slides = [];
  assert.ok(validatePortfolioPublicationMetadata(emptyProof)
    .some((issue) => issue.includes("로컬 기밀 블러 증명")));

  const emptyBodyIndexes = portfolioMetadata("short_psd", [2, 1, 1, 1]);
  emptyBodyIndexes.portfolioAssets[1].slideIndexes = [];
  const issues = validatePortfolioPublicationMetadata(emptyBodyIndexes);
  assert.ok(issues.some((issue) => issue.includes("비어 있지 않은 고유 장표")));
  assert.ok(issues.some((issue) => issue.includes("자산별 고유 인덱스")));
});
