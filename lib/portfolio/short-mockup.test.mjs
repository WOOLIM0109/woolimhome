import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  classifyShortMockupAspectRatio,
  renderShortDocumentMockups,
} from "./short-mockup.ts";

async function sampleSlide(index, width = 320, height = 180) {
  const color = `hsl(${(index * 43) % 360}, 60%, 55%)`;
  const buffer = await sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer();
  return { index, buffer };
}

test("classifies only the four supported short-mockup ratios", () => {
  assert.equal(classifyShortMockupAspectRatio(16 / 9), "16:9");
  assert.equal(classifyShortMockupAspectRatio(4 / 3), "4:3");
  assert.equal(classifyShortMockupAspectRatio(297 / 210), "a4_landscape");
  assert.equal(classifyShortMockupAspectRatio(210 / 297), "a4_portrait");
  assert.equal(classifyShortMockupAspectRatio(1100 / 850), "unknown");
});

test("renders four boards without repeating selected slides", async () => {
  const slides = await Promise.all(Array.from({ length: 14 }, (_, index) => sampleSlide(index)));
  const result = await renderShortDocumentMockups({
    deckSlideCount: 19,
    aspectClass: "16:9",
    slides: [...slides, slides[0]],
  });
  assert.equal(result.mode, "short_psd");
  assert.equal(result.bodyBoardCount, 4);
  assert.equal(result.selectedSlideCount, 14);
  assert.equal(new Set(result.selectedSlideIndexes).size, 14);
  assert.deepEqual(result.boards.map((board) => board.slideIndexes.length), [5, 3, 3, 3]);
  assert.deepEqual(result.boards.map((board) => [board.width, board.height]), [
    [1600, 1600],
    [1600, 900],
    [1600, 900],
    [1600, 900],
  ]);
  for (const board of result.boards) {
    const metadata = await sharp(board.bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, board.width);
    assert.equal(metadata.height, board.height);
  }
});

test("renders five distinct 16:9 slides into the five visible PSD main slots", async () => {
  const colors = [
    { r: 245, g: 35, b: 35 },
    { r: 35, g: 210, b: 70 },
    { r: 35, g: 80, b: 235 },
    { r: 240, g: 205, b: 25 },
    { r: 220, g: 35, b: 205 },
  ];
  const slides = await Promise.all(Array.from({ length: 14 }, async (_, index) => ({
    index,
    buffer: await sharp({
      create: {
        width: 320 + index,
        height: 180,
        channels: 3,
        background: colors[index % colors.length],
      },
    }).png().toBuffer(),
  })));
  const result = await renderShortDocumentMockups({
    deckSlideCount: 14,
    aspectClass: "16:9",
    slides,
  });
  const rendered = await sharp(result.boards[0].bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const target of colors) {
    let matchingPixels = 0;
    for (let offset = 0; offset < rendered.data.length; offset += 3) {
      const distance = Math.abs(rendered.data[offset] - target.r)
        + Math.abs(rendered.data[offset + 1] - target.g)
        + Math.abs(rendered.data[offset + 2] - target.b);
      if (distance <= 70) matchingPixels += 1;
    }
    assert.ok(matchingPixels > 1_000, `missing visible PSD slot for ${JSON.stringify(target)}`);
  }
});

test("fills every visible main slot before distributing slides to detail boards", async () => {
  const slides = await Promise.all(Array.from({ length: 5 }, (_, index) => sampleSlide(index, 210, 297)));
  const result = await renderShortDocumentMockups({
    deckSlideCount: 5,
    aspectClass: "a4_portrait",
    slides,
  });
  assert.deepEqual(result.boards.map((board) => board.slideIndexes.length), [5, 0, 0, 0]);
  assert.deepEqual(result.boards.flatMap((board) => board.slideIndexes), [0, 1, 2, 3, 4]);
});

test("removes byte-identical slides even when their source indexes differ", async () => {
  const slides = await Promise.all(Array.from({ length: 5 }, (_, index) => sampleSlide(index)));
  const duplicateAtAnotherIndex = { index: 5, buffer: slides[0].buffer };
  const result = await renderShortDocumentMockups({
    deckSlideCount: 6,
    aspectClass: "16:9",
    slides: [...slides, duplicateAtAnotherIndex],
  });
  assert.equal(result.selectedSlideCount, 5);
  assert.ok(!result.selectedSlideIndexes.includes(5));
});

test("uses only visible 4:3 template slots and reports every rendered slide", async () => {
  const slides = await Promise.all(Array.from({ length: 14 }, (_, index) => sampleSlide(index, 400, 300)));
  const result = await renderShortDocumentMockups({
    deckSlideCount: 19,
    aspectClass: "4:3",
    slides,
  });
  const renderedIndexes = result.boards.flatMap((board) => board.slideIndexes);
  assert.equal(result.selectedSlideCount, 13);
  assert.equal(new Set(renderedIndexes).size, 13);
  assert.deepEqual([...renderedIndexes].sort((a, b) => a - b), result.selectedSlideIndexes);
  assert.deepEqual(result.boards.map((board) => board.slideIndexes.length), [4, 3, 3, 3]);
});

test("rejects decks outside the 5-19 slide boundary", async () => {
  const slides = await Promise.all(Array.from({ length: 5 }, (_, index) => sampleSlide(index)));
  await assert.rejects(
    renderShortDocumentMockups({ deckSlideCount: 20, aspectClass: "16:9", slides }),
    /5~19/,
  );
});
