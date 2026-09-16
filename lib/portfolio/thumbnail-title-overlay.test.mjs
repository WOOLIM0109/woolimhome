import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
  normalizeThumbnailTitleSpec,
  renderThumbnailTitleOverlay,
  thumbnailTitleOverlayFingerprint,
  validateThumbnailTitleLayout,
} from "./thumbnail-title-overlay.ts";
import { approvedBoardRendererFingerprint } from "./approved-assigned-board-renderer.ts";
import { APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES } from "./approved-mockup-runtime.ts";

const title = { main: "행사 대행 제안서", sub: "광양시민의 날", showSub: true, style: "bold" };
const aspects = ["16:9", "a4_landscape", "a4_portrait"];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const createBase = (dimension = 1080) => sharp({ create: {
  width: dimension, height: dimension, channels: 4, background: "#EDEAE6",
} }).png().toBuffer();

test("explicit title schema normalizes NFC and spaces without altering wording", () => {
  assert.deepEqual(normalizeThumbnailTitleSpec({
    main: "  행사   대행 제안서 ".normalize("NFD"), sub: "  광양시민의 날  ", showSub: true, style: "bold",
  }), title);
  assert.deepEqual(normalizeThumbnailTitleSpec({ ...title, sub: "", showSub: false }),
    { ...title, sub: "", showSub: false });
});

test("unknown fields, legacy strings and implicit booleans/styles never migrate silently", () => {
  for (const input of [null, [], "행사 대행 제안서", {}, new Date(),
    { ...title, extra: "no" }, { ...title, showSub: "false" },
    { ...title, style: "anything" }, { main: title.main, sub: title.sub, showSub: true },
    { ...title, main: 1 }]) {
    assert.throws(() => normalizeThumbnailTitleSpec(input), /MOCKUP_TITLE_INVALID/);
  }
});

test("controls, line breaks, unpaired surrogates and bidi tricks fail before rendering", () => {
  for (const character of ["\n", "\r", "\t", "\0", "\u200B", "\u202E", "\u2066", "\uFE0F", "\uD800", "\u00A0"]) {
    assert.throws(() => normalizeThumbnailTitleSpec({ ...title, main: `행사${character}제안서` }),
      /MOCKUP_TITLE_INVALID_CHARACTER/);
  }
});

test("empty main and oversized input are rejected; empty optional sub is valid", () => {
  assert.throws(() => normalizeThumbnailTitleSpec({ ...title, main: " " }), /MOCKUP_TITLE_REQUIRED/);
  assert.throws(() => normalizeThumbnailTitleSpec({ ...title, main: "가".repeat(41) }), /MOCKUP_TITLE_TOO_LONG/);
  assert.throws(() => normalizeThumbnailTitleSpec({ ...title, sub: "가".repeat(61) }), /MOCKUP_TITLE_TOO_LONG/);
  assert.equal(normalizeThumbnailTitleSpec({ ...title, sub: "" }).sub, "");
});

test("bundled font cmap prevents emoji and unknown glyph fallback even in hidden sub", async () => {
  for (const main of ["제안서🙂", "제안서\u{10FFFF}"]) {
    await assert.rejects(validateThumbnailTitleLayout({ ...title, main }, "16:9"),
      /MOCKUP_TITLE_UNSUPPORTED_GLYPH/);
  }
  await assert.rejects(validateThumbnailTitleLayout({ ...title, sub: "🙂", showSub: false }, "16:9"),
    /MOCKUP_TITLE_UNSUPPORTED_GLYPH/);
});

test("main type is prominent and brand is smaller, with no automatic line wrapping", async () => {
  for (const aspect of aspects) {
    const layout = await validateThumbnailTitleLayout(title, aspect);
    assert.equal(layout.main.fontSize, 54);
    assert.equal(layout.sub.fontSize, 22);
    assert.equal(layout.main.text, title.main);
    assert.equal(layout.sub.text, title.sub);
    assert.equal(layout.main.font, "Paperlogy 8ExtraBold");
    assert.equal(layout.sub.color, "#ef762d");
    assert.ok(layout.main.top + layout.main.height < layout.sub.top);
    assert.ok(layout.main.left >= 155); // locked logo ends at x=137
  }
});

test("three actual sample titles fit with no extreme shrinking or card movement", async () => {
  const samples = [
    ["16:9", { main: "초기창업패키지 발표자료", sub: "", showSub: false, style: "bold" }],
    ["a4_landscape", title],
    ["a4_portrait", { main: "건물관리 제안서", sub: "", showSub: false, style: "bold" }],
  ];
  for (const [aspect, sample] of samples) {
    const layout = await validateThumbnailTitleLayout(sample, aspect);
    assert.ok(layout.main.fontSize >= 44 && layout.main.fontSize <= 54);
    assert.equal(layout.main.text, sample.main);
  }
});

test("long main and visible sub stop with an actionable error, rather than crop or squash", async () => {
  for (const aspect of aspects) {
    await assert.rejects(validateThumbnailTitleLayout({ ...title, main: "가".repeat(40) }, aspect), /MOCKUP_TITLE_TOO_WIDE/);
    await assert.rejects(validateThumbnailTitleLayout({ ...title, sub: "가".repeat(60) }, aspect), /MOCKUP_TITLE_TOO_WIDE/);
  }
  const hidden = await validateThumbnailTitleLayout({ ...title, sub: "가".repeat(60), showSub: false }, "16:9");
  assert.equal(hidden.sub, null);
});

test("the rising top edge is an actual fit constraint, not just a rectangular text box", async () => {
  for (const aspect of ["16:9", "a4_landscape"]) {
    const rail = aspect === "16:9" ? { x: -150, y: 190, angle: -9 } : { x: -160, y: 215, angle: -8 };
    const layout = await validateThumbnailTitleLayout(title, aspect);
    for (const line of [layout.main, layout.sub].filter(Boolean)) {
      const right = line.left + line.width;
      const railY = rail.y + (right - rail.x) * Math.tan(rail.angle * Math.PI / 180);
      assert.ok(line.top + line.height <= railY - 8);
    }
  }
});

test("tall supported Latin and Korean glyphs keep eight pixels between main and sub", async () => {
  for (const aspect of aspects) for (const main of ["WÅg한글", "Ágj"]) {
    const value = { ...title, main, sub: "확인용 보조 제목", showSub: true };
    let visible;
    try { visible = await validateThumbnailTitleLayout(value, aspect); }
    catch (error) { assert.match(error.message, /MOCKUP_TITLE_TOO_WIDE/); }
    if (visible) {
      assert.ok(visible.main.top + visible.main.height + 8 <= visible.sub.top);
      assert.ok(visible.main.fontSize >= 44);
    }
    const hidden = await validateThumbnailTitleLayout({ ...value, showSub: false }, aspect);
    assert.equal(hidden.sub, null);
    assert.ok(hidden.main.fontSize >= (visible?.main.fontSize ?? 44));
  }
});

test("literal markup characters render as text, without style injection", async () => {
  const result = await renderThumbnailTitleOverlay({ basePng: await createBase(),
    title: { ...title, main: "<제안> & 검토", sub: "", showSub: false }, aspectClass: "a4_portrait", scale: 1 });
  assert.equal(result.layout.main.text, "<제안> & 검토");
  assert.equal(result.layout.main.color, "#253038");
});

test("only text pixels change in each format; the caller's base PNG stays immutable", async () => {
  const base = await createBase();
  const hash = digest(base);
  const before = await sharp(base).ensureAlpha().raw().toBuffer();
  for (const aspect of aspects) {
    const result = await renderThumbnailTitleOverlay({ basePng: base, title, aspectClass: aspect, scale: 1 });
    const after = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
    let changed = 0;
    for (let y = 0; y < 1080; y += 1) for (let x = 0; x < 1080; x += 1) {
      const offset = (y * 1080 + x) * 4;
      if (!before.subarray(offset, offset + 4).equals(after.subarray(offset, offset + 4))) {
        changed += 1;
        assert.ok(result.layout.renderedLines.some((line) => x >= line.left && x < line.left + line.width
          && y >= line.top && y < line.top + line.height));
      }
    }
    assert.ok(changed > 1000);
    assert.equal(result.layout.outsideTitlePixelChanges, 0);
    assert.equal(digest(base), hash);
  }
});

test("draft and final share exact full-size text metrics and differ only by scale", async () => {
  for (const aspect of aspects) {
    const final = await renderThumbnailTitleOverlay({ basePng: await createBase(), title, aspectClass: aspect, scale: 1 });
    const draft = await renderThumbnailTitleOverlay({ basePng: await createBase(540), title, aspectClass: aspect, scale: 0.5 });
    for (const key of ["main", "sub", "titleRegion", "baseCanvas", "aspectClass", "style", "version"]) {
      assert.deepEqual(draft.layout[key], final.layout[key]);
    }
    assert.equal(draft.layout.renderedLines.length, final.layout.renderedLines.length);
    for (const [index, line] of draft.layout.renderedLines.entries()) {
      const full = final.layout.renderedLines[index];
      for (const key of ["left", "top", "width", "height", "fontSize"]) {
        assert.ok(Math.abs(line[key] * 2 - full[key]) <= 1);
      }
    }
  }
});

test("sub-title hidden and empty both produce no extra line, without changing main metrics", async () => {
  const visible = await validateThumbnailTitleLayout(title, "a4_portrait");
  for (const sample of [{ ...title, showSub: false }, { ...title, sub: "" }]) {
    const hidden = await validateThumbnailTitleLayout(sample, "a4_portrait");
    assert.equal(hidden.sub, null);
    assert.deepEqual(hidden.main, visible.main);
  }
});

test("wrong image dimensions, non-PNG, unsupported aspect and arbitrary scale fail closed", async () => {
  const base = await createBase();
  const valid = { basePng: base, title, aspectClass: "16:9", scale: 1 };
  await assert.rejects(renderThumbnailTitleOverlay({ ...valid, basePng: await createBase(540) }), /MOCKUP_TITLE_BASE_INVALID/);
  await assert.rejects(renderThumbnailTitleOverlay({ ...valid, basePng: await sharp(base).jpeg().toBuffer() }), /MOCKUP_TITLE_BASE_INVALID/);
  await assert.rejects(renderThumbnailTitleOverlay({ ...valid, basePng: Buffer.alloc(0) }), /MOCKUP_TITLE_BASE_INVALID/);
  await assert.rejects(renderThumbnailTitleOverlay({ ...valid, scale: 0.75 }), /MOCKUP_TITLE_SCALE_INVALID/);
  await assert.rejects(renderThumbnailTitleOverlay({ ...valid, aspectClass: "custom" }), /MOCKUP_TITLE_ASPECT_UNSUPPORTED/);
});

test("rendering is deterministic, and title-specific fingerprint is stable", async () => {
  const input = { basePng: await createBase(), title, aspectClass: "16:9", scale: 1 };
  const first = await renderThumbnailTitleOverlay(input);
  const second = await renderThumbnailTitleOverlay(input);
  assert.equal(digest(first.bytes), digest(second.bytes));
  assert.deepEqual(first.layout, second.layout);
  const fingerprint = await thumbnailTitleOverlayFingerprint();
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(await thumbnailTitleOverlayFingerprint(), fingerprint);
});

test("new title overlay is excluded from frozen BODY runtime dependencies", async () => {
  assert.ok(APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES.every((name) => !name.includes("thumbnail-title-overlay")));
  const before = await approvedBoardRendererFingerprint("a4_landscape", "a4-landscape-body-3-stage");
  await renderThumbnailTitleOverlay({ basePng: await createBase(), title, aspectClass: "a4_landscape", scale: 1 });
  const after = await approvedBoardRendererFingerprint("a4_landscape", "a4-landscape-body-3-stage");
  assert.equal(after, before);
  const source = await readFile(new URL("./thumbnail-title-overlay.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("fetch("));
  assert.ok(!source.includes("writeFile("));
});
