import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalRedactionProof,
  isCurrentPortfolioRedactionProof,
  isPortfolioSlideRedactionProofForManifest,
  isVerifiedPortfolioRedactionProof,
  parseLocalRedactionManifest,
} from "./redaction-proof.ts";

const SOURCE_FINGERPRINT = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const REDACTED_HASH = "c".repeat(64);

function manifest() {
  return {
    version: 2,
    method: "powerpoint_com_shapes_v2",
    sourceSlideCount: 5,
    slideCount: 5,
    slides: [0, 1, 2, 3, 4].map((slideIndex) => ({
      slideIndex,
      sourceSlideNumber: slideIndex + 1,
      inspectionStatus: "verified",
      regions: [{
        slideIndex,
        // 기본 정책에서 실제로 가리는 종류를 씁니다.
        type: "client_identifier",
        label: "local_identifier",
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.2,
      }],
    })),
  };
}

test("accepts a complete normalized local PowerPoint manifest", () => {
  const parsed = parseLocalRedactionManifest(manifest(), 5);
  assert.ok(parsed);
  assert.equal(parsed.slides[1].regions[0].slideIndex, 1);
});

test("rejects missing slides and out-of-bounds coordinates", () => {
  const missing = manifest();
  missing.slides.pop();
  assert.equal(parseLocalRedactionManifest(missing, 5), null);
  const outside = manifest();
  outside.slides[0].regions[0].x = 0.9;
  outside.slides[0].regions[0].width = 0.2;
  assert.equal(parseLocalRedactionManifest(outside, 5), null);
});

test("requires every selected slide to have a changed redacted image", () => {
  const parsed = parseLocalRedactionManifest(manifest(), 5);
  assert.ok(parsed);
  const proof = createLocalRedactionProof({
    manifest: parsed,
    sourceFingerprint: SOURCE_FINGERPRINT,
    selectedSlideIndexes: [0, 1],
    slides: [0, 1].map((slideIndex) => ({
      slideIndex,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.12,
    })),
  });
  assert.equal(proof.version, 2);
  assert.equal(isCurrentPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1]), true);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1], parsed), true);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, "d".repeat(64), [0, 1], parsed), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [], parsed), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0], parsed), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1, 2], parsed), false);
  assert.equal(isVerifiedPortfolioRedactionProof({
    ...proof,
    slides: [...proof.slides, {
      slideIndex: 2,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.12,
    }],
  }, SOURCE_FINGERPRINT, [0, 1], parsed), false);
  assert.throws(() => createLocalRedactionProof({
    manifest: parsed,
    sourceFingerprint: SOURCE_FINGERPRINT,
    selectedSlideIndexes: [0, 1],
    slides: [{
      slideIndex: 0,
      sourceHash: SOURCE_HASH,
      redactedHash: SOURCE_HASH,
      regionCount: 1,
      changedPixelRatio: 0,
    }],
  }));
});

test("strictly binds zero-region proofs to an unchanged selected slide", () => {
  const input = manifest();
  input.slides[0].regions = [];
  const parsed = parseLocalRedactionManifest(input, 5);
  assert.ok(parsed);
  const proof = createLocalRedactionProof({
    manifest: parsed,
    sourceFingerprint: SOURCE_FINGERPRINT,
    selectedSlideIndexes: [0, 1],
    slides: [{
      slideIndex: 0,
      sourceHash: SOURCE_HASH,
      redactedHash: SOURCE_HASH,
      regionCount: 0,
      changedPixelRatio: 0,
    }, {
      slideIndex: 1,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.12,
    }],
  });
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1], parsed), true);
  const changedZeroRegion = structuredClone(proof);
  changedZeroRegion.slides[0].redactedHash = REDACTED_HASH;
  changedZeroRegion.slides[0].changedPixelRatio = 0.1;
  assert.equal(isVerifiedPortfolioRedactionProof(
    changedZeroRegion,
    SOURCE_FINGERPRINT,
    [0, 1],
    parsed,
  ), false);
});

test("rejects a full-slide or oversized manifest from proof verification", () => {
  const input = manifest();
  input.slides[0].regions[0] = {
    ...input.slides[0].regions[0], x: 0, y: 0, width: 1, height: 1,
  };
  const parsed = parseLocalRedactionManifest(input, 5);
  assert.ok(parsed);
  assert.throws(() => createLocalRedactionProof({
    manifest: parsed,
    sourceFingerprint: SOURCE_FINGERPRINT,
    selectedSlideIndexes: [0],
    slides: [{
      slideIndex: 0,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.99,
    }],
  }));
});

test("rejects proof reuse with a different normalized manifest", () => {
  const parsed = parseLocalRedactionManifest(manifest(), 5);
  assert.ok(parsed);
  const proof = createLocalRedactionProof({
    manifest: parsed,
    sourceFingerprint: SOURCE_FINGERPRINT,
    selectedSlideIndexes: [0],
    slides: [{
      slideIndex: 0,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.12,
    }],
  });
  const changed = structuredClone(parsed);
  changed.slides[0].regions[0].x = 0.2;
  assert.equal(isCurrentPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0]), true);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0], changed), false);
});

test("정책이 남긴 캐릭터·아이콘 때문에 가린 개수가 줄어도 통과한다", () => {
  // 사진 판별이 캐릭터를 남기면 실제로 가린 개수가 기록보다 적어집니다.
  // 적은 것은 허용하고, 기록보다 많이 가린 경우만 막습니다.
  const slide = {
    slideIndex: 0,
    sourceSlideNumber: 1,
    inspectionStatus: "verified",
    regions: [
      { slideIndex: 0, type: "client_identifier", label: "local_identifier", x: 0.1, y: 0.1, width: 0.2, height: 0.02 },
      { slideIndex: 0, type: "embedded_photo", label: "local_picture", x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
    ],
  };
  const hash = (value) => value.repeat(64).slice(0, 64);
  assert.equal(isPortfolioSlideRedactionProofForManifest({
    slideIndex: 0,
    regionCount: 1,
    changedPixelRatio: 0.02,
    sourceHash: hash("a"),
    redactedHash: hash("b"),
  }, slide), true);
  assert.equal(isPortfolioSlideRedactionProofForManifest({
    slideIndex: 0,
    regionCount: 3,
    changedPixelRatio: 0.02,
    sourceHash: hash("a"),
    redactedHash: hash("b"),
  }, slide), false, "기록보다 많이 가리면 통과하면 안 됩니다.");
});

test("한 곳도 가리지 않았으면 원본이 그대로여야 한다", () => {
  const slide = {
    slideIndex: 0,
    sourceSlideNumber: 1,
    inspectionStatus: "verified",
    regions: [
      { slideIndex: 0, type: "embedded_photo", label: "local_picture", x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
    ],
  };
  const hash = (value) => value.repeat(64).slice(0, 64);
  assert.equal(isPortfolioSlideRedactionProofForManifest({
    slideIndex: 0,
    regionCount: 0,
    changedPixelRatio: 0,
    sourceHash: hash("a"),
    redactedHash: hash("a"),
  }, slide), true);
  assert.equal(isPortfolioSlideRedactionProofForManifest({
    slideIndex: 0,
    regionCount: 0,
    changedPixelRatio: 0.4,
    sourceHash: hash("a"),
    redactedHash: hash("b"),
  }, slide), false, "가린 곳이 없는데 그림이 바뀌면 통과하면 안 됩니다.");
});
