import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { renderApprovedMockupTitle } from "./approved-mockup-title.ts";
import { APPROVED_MOCKUP_DEFAULT_TITLE_BOX } from "./approved-16x9-templates.ts";

test("short thumbnail titles never grow to fill the box", async () => {
  const box = APPROVED_MOCKUP_DEFAULT_TITLE_BOX;
  const overlay = await renderApprovedMockupTitle("가", box);
  const metadata = await sharp(overlay.input).metadata();
  assert.ok(metadata.height <= box.fontSize * 1.5);
  assert.ok(metadata.width <= box.fontSize * 1.5);
  assert.equal(overlay.left + metadata.width, box.left + box.width);
  assert.equal(overlay.top, box.top);
});

test("long Korean titles shrink into the locked box without markup injection", async () => {
  for (const box of [APPROVED_MOCKUP_DEFAULT_TITLE_BOX, {
    left: 300, top: 36, width: 650, height: 60, fontSize: 34, align: "right",
  }]) {
    const overlay = await renderApprovedMockupTitle(
      "생활폐기물 수집·운반·대행용역 입찰제안서 — 장기 운영계획과 서비스 개선 방향 <테스트> & 검토",
      box,
    );
    const metadata = await sharp(overlay.input).metadata();
    assert.ok(metadata.width <= box.width);
    assert.ok(metadata.height <= box.height);
    assert.equal(overlay.left + metadata.width, box.left + box.width);
    assert.equal(overlay.top, box.top);
  }
});

test("empty titles do not produce an overlay", async () => {
  assert.equal(await renderApprovedMockupTitle("   ", APPROVED_MOCKUP_DEFAULT_TITLE_BOX), null);
});
