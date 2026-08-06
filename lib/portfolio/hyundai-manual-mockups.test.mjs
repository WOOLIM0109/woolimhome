import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHyundaiManualMockups,
  buildHyundaiManualMockupMetadata,
  correctHyundaiManualContentMetadata,
  HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE,
  HYUNDAI_MANUAL_MOCKUP_TITLE,
} from "./hyundai-manual-mockups.ts";

const bodyHtml = [
  "<h2>제안서 구조</h2><p>첫 문단입니다.</p>",
  '<figure><img src="https://old/one.jpg" alt="one"><figcaption>one</figcaption></figure>',
  "<p>둘째 문단입니다.</p>",
  '<figure><img src="https://old/two.jpg" alt="two"><figcaption>two</figcaption></figure>',
  "<p>셋째 문단입니다.</p>",
  '<figure><img src="https://old/three.jpg" alt="three"><figcaption>three</figcaption></figure>',
].join("");

test("replaces only the three body image sources and preserves article text", () => {
  const metadata = buildHyundaiManualMockupMetadata({
    generated: { bodyHtml },
    portfolioAssets: [
      { kind: "thumbnail", url: "https://old/thumbnail.jpg" },
      { kind: "body_image", url: "https://old/one.jpg", caption: "one" },
      { kind: "body_image", url: "https://old/two.jpg", caption: "two" },
      { kind: "body_image", url: "https://old/three.jpg", caption: "three" },
    ],
    portfolioMockup: { redactionCoverage: 1 },
  }, "https://woolim-site.vercel.app");
  assert.ok(metadata);
  const replaced = metadata.generated.bodyHtml;
  assert.equal(replaced.replace(/src="[^"]+"/g, 'src=""'), bodyHtml.replace(/src="[^"]+"/g, 'src=""'));
  assert.equal((replaced.match(/hyundai-sanitation/g) || []).length, 3);
  assert.equal(metadata.portfolioAssets.length, 4);
  assert.equal(metadata.portfolioMockup.bodyBoardCount, 3);
  assert.deepEqual(metadata.portfolioMockup.selectedSlideIndexes, Array.from({ length: 16 }, (_, index) => index));
});

test("exposes one thumbnail and three user-redacted body boards for the exact review item", () => {
  const item = applyHyundaiManualMockups({
    id: "work-item",
    title: HYUNDAI_MANUAL_MOCKUP_TITLE,
    format: "portfolio",
    metadata: { generated: { bodyHtml } },
    content_review_assets: [{ id: "preview", asset_type: "article_preview", public_url: "https://old/preview" }],
  }, "https://woolim-site.vercel.app");
  assert.equal(item.content_review_assets.length, 5);
  assert.deepEqual(
    item.content_review_assets.slice(1).map((asset) => asset.asset_type),
    ["thumbnail", "body_image", "body_image", "body_image"],
  );
  assert.equal(item.metadata.manualMockupOverride.kind, "powerpoint_native_user_redacted");
});

test("keeps manual mockups attached while the database still has the legacy title", () => {
  const item = applyHyundaiManualMockups({
    id: "legacy-work-item",
    title: HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE,
    format: "portfolio",
    metadata: { generated: { bodyHtml } },
    content_review_assets: [],
  }, "https://woolim-site.vercel.app");
  assert.equal(item.content_review_assets.length, 4);
});

test("corrects the article to the sanitation bid source deck without changing mockup count", () => {
  const metadata = correctHyundaiManualContentMetadata({
    generated: { bodyHtml, faq: [] },
    portfolioAssets: [
      { kind: "thumbnail", url: "https://old/thumbnail.jpg" },
      { kind: "body_image", url: "https://old/one.jpg", caption: "old one" },
      { kind: "body_image", url: "https://old/two.jpg", caption: "old two" },
      { kind: "body_image", url: "https://old/three.jpg", caption: "old three" },
    ],
  }, "https://woolim-site.vercel.app");
  assert.ok(metadata);
  assert.equal(metadata.generated.title, HYUNDAI_MANUAL_MOCKUP_TITLE);
  assert.equal(metadata.generated.faq.length, 4);
  assert.equal((metadata.generated.bodyHtml.match(/<figure>/g) || []).length, 3);
  assert.equal(metadata.portfolioAssets.filter((asset) => asset.kind === "body_image").length, 3);
  assert.equal(metadata.contentCorrection.sourceSlideCount, 16);
  assert.doesNotMatch(metadata.generated.bodyHtml, /대기업|의사결정권자|비즈니스 모델/);
  assert.match(metadata.generated.bodyHtml, /생활폐기물 수집·운반 대행용역/);
});
