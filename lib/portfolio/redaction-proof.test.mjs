import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalRedactionProof,
  isVerifiedPortfolioRedactionProof,
  parseLocalRedactionManifest,
} from "./redaction-proof.ts";

const SOURCE_FINGERPRINT = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const REDACTED_HASH = "c".repeat(64);

function manifest() {
  return {
    version: 1,
    method: "powerpoint_com_shapes_v1",
    slideCount: 5,
    slides: [0, 1, 2, 3, 4].map((slideIndex) => ({
      slideIndex,
      sourceSlideNumber: slideIndex + 1,
      regions: [{
        slideIndex,
        type: "body_text",
        label: "local_body_text",
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
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1]), true);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, "d".repeat(64), [0, 1]), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, []), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0]), false);
  assert.equal(isVerifiedPortfolioRedactionProof(proof, SOURCE_FINGERPRINT, [0, 1, 2]), false);
  assert.equal(isVerifiedPortfolioRedactionProof({
    ...proof,
    slides: [...proof.slides, {
      slideIndex: 2,
      sourceHash: SOURCE_HASH,
      redactedHash: REDACTED_HASH,
      regionCount: 1,
      changedPixelRatio: 0.12,
    }],
  }, SOURCE_FINGERPRINT, [0, 1]), false);
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
