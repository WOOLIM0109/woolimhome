import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  findDuplicatePortfolioImage,
  fingerprintPortfolioImage,
  perceptualHashDistance,
} from "./image-fingerprint.ts";

const sourceSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#ffffff"/>
  <rect x="30" y="40" width="250" height="70" fill="#ee5b2a"/>
  <circle cx="440" cy="200" r="90" fill="#234f9b"/>
</svg>`);

test("finds visually identical re-encoded slide images", async () => {
  const first = await fingerprintPortfolioImage(await sharp(sourceSvg).png().toBuffer());
  const second = await fingerprintPortfolioImage(await sharp(sourceSvg).jpeg({ quality: 82 }).toBuffer());
  assert.notEqual(first.contentHash, second.contentHash);
  assert.ok(perceptualHashDistance(first.visualHash, second.visualHash) <= 4);
  assert.deepEqual(findDuplicatePortfolioImage([first, second]), {
    duplicatePosition: 0,
    position: 1,
  });
});

test("keeps materially different slide images distinct", async () => {
  const first = await fingerprintPortfolioImage(await sharp(sourceSvg).png().toBuffer());
  const second = await fingerprintPortfolioImage(await sharp({
    create: { width: 640, height: 360, channels: 3, background: "#111827" },
  }).png().toBuffer());
  assert.equal(findDuplicatePortfolioImage([first, second]), null);
});
