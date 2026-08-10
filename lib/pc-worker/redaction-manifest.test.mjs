import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticDesignEligibleSlideIndexes,
  inspectLocalRedactionSlideSafety,
  localRedactionUnionCoverage,
  validateLocalRedactionManifest,
} from "./redaction-manifest.ts";

function manifest() {
  return {
    version: 2,
    method: "powerpoint_com_shapes_v2",
    sourceSlideCount: 5,
    slideCount: 5,
    slides: Array.from({ length: 5 }, (_, slideIndex) => ({
      slideIndex,
      sourceSlideNumber: slideIndex + 1,
      inspectionStatus: "verified",
      regions: [{
        slideIndex,
        // 기본 정책에서 실제로 가리는 종류를 씁니다.
        // 남기는 종류를 쓰면 면적 검사가 0으로 계산되어 검사 자체가 무의미해집니다.
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

test("accepts a complete PowerPoint COM manifest", () => {
  const result = validateLocalRedactionManifest(manifest(), 5);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.manifest.slides[4].regions[0].slideIndex, 4);
});

test("accepts a verified slide with no sensitive regions", () => {
  const input = manifest();
  input.slides[2].regions = [];
  const result = validateLocalRedactionManifest(input, 5);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.manifest.slides[2].inspectionStatus, "verified");
    assert.deepEqual(result.manifest.slides[2].regions, []);
  }
});

test("rejects unsupported metadata and incomplete slide indexes", () => {
  const unsupported = manifest();
  unsupported.method = "image_ai_v1";
  assert.equal(validateLocalRedactionManifest(unsupported, 5).ok, false);

  const legacy = manifest();
  legacy.version = 1;
  legacy.method = "powerpoint_com_shapes_v1";
  assert.equal(validateLocalRedactionManifest(legacy, 5).ok, false);

  const unverified = manifest();
  unverified.slides[1].inspectionStatus = "failed";
  assert.equal(validateLocalRedactionManifest(unverified, 5).ok, false);

  const missingSourceCount = manifest();
  delete missingSourceCount.sourceSlideCount;
  assert.equal(validateLocalRedactionManifest(missingSourceCount, 5).ok, false);

  const impossibleSourceCount = manifest();
  impossibleSourceCount.sourceSlideCount = 4;
  assert.equal(validateLocalRedactionManifest(impossibleSourceCount, 5).ok, false);

  const wrongIndex = manifest();
  wrongIndex.slides[2].regions[0].slideIndex = 3;
  assert.equal(validateLocalRedactionManifest(wrongIndex, 5).ok, false);

  const missingSlide = manifest();
  missingSlide.slides.pop();
  assert.equal(validateLocalRedactionManifest(missingSlide, 5).ok, false);
});

test("rejects unsafe coordinates, types, labels, and source ordering", () => {
  const outside = manifest();
  outside.slides[0].regions[0].x = 0.9;
  outside.slides[0].regions[0].width = 0.2;
  assert.equal(validateLocalRedactionManifest(outside, 5).ok, false);

  const arbitraryType = manifest();
  arbitraryType.slides[0].regions[0].type = "public_title";
  assert.equal(validateLocalRedactionManifest(arbitraryType, 5).ok, false);

  const leakedLabel = manifest();
  leakedLabel.slides[0].regions[0].label = "client name must not leave the PC";
  assert.equal(validateLocalRedactionManifest(leakedLabel, 5).ok, false);

  const legacyGroupFallback = manifest();
  legacyGroupFallback.slides[0].regions[0].type = "screenshot";
  legacyGroupFallback.slides[0].regions[0].label = "local_group";
  assert.equal(validateLocalRedactionManifest(legacyGroupFallback, 5).ok, false);

  const duplicateSource = manifest();
  duplicateSource.slides[2].sourceSlideNumber = 2;
  assert.equal(validateLocalRedactionManifest(duplicateSource, 5).ok, false);
});

test("drops unrecognized fields before storing the manifest", () => {
  const input = manifest();
  input.slides[0].regions[0].secret = "must not survive";
  const result = validateLocalRedactionManifest(input, 5);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal("secret" in result.manifest.slides[0].regions[0], false);
});

test("computes geometric union coverage without double-counting overlap", () => {
  const overlapping = [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.25, y: 0, width: 0.5, height: 0.5 },
  ];
  assert.equal(localRedactionUnionCoverage(overlapping), 0.375);
});

test("excludes full-slide and near-total masks but allows large selective masks", () => {
  const input = manifest();
  input.slides[0].regions[0] = {
    ...input.slides[0].regions[0], x: 0, y: 0, width: 1, height: 1,
  };
  input.slides[1].regions[0] = {
    ...input.slides[1].regions[0], x: 0, y: 0, width: 0.8, height: 0.7,
  };
  input.slides[2].regions = [
    { ...input.slides[2].regions[0], x: 0, y: 0, width: 0.5, height: 0.7 },
    { ...input.slides[2].regions[0], x: 0.5, y: 0, width: 0.5, height: 0.7 },
  ];
  input.slides[3].regions = [];
  input.slides[4].regions = [
    { ...input.slides[4].regions[0], x: 0, y: 0, width: 0.95, height: 1 },
  ];
  const parsed = validateLocalRedactionManifest(input, 5);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(inspectLocalRedactionSlideSafety(parsed.manifest.slides[0]).hasFullSlideRegion, true);
  assert.equal(inspectLocalRedactionSlideSafety(parsed.manifest.slides[1]).hasOversizedRegion, true);
  assert.equal(inspectLocalRedactionSlideSafety(parsed.manifest.slides[2]).unionCoverage, 0.7);
  assert.equal(inspectLocalRedactionSlideSafety(parsed.manifest.slides[4]).hasNearTotalCoverage, true);
  assert.deepEqual(automaticDesignEligibleSlideIndexes(parsed.manifest), [1, 2, 3]);
});
