import assert from "node:assert/strict";
import test from "node:test";
import { validateLocalRedactionManifest } from "./redaction-manifest.ts";

function manifest() {
  return {
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

test("rejects unsupported metadata and incomplete slide indexes", () => {
  const unsupported = manifest();
  unsupported.method = "image_ai_v1";
  assert.equal(validateLocalRedactionManifest(unsupported, 5).ok, false);

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
