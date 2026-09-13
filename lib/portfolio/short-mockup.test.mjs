import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  classifyShortMockupAspectRatio,
  renderApprovedTemplateBodyMockups,
  renderShortDocumentMockups,
} from "./short-mockup.ts";
import {
  APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION,
} from "./approved-a4-landscape-templates.ts";

const APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_IDS = [
  "a4-landscape-body-3-stage",
  "a4-landscape-body-4-corridor",
  "a4-landscape-body-5-grid",
  "a4-landscape-body-6-lattice",
];

async function sampleSlide(index, width = 320, height = 180) {
  const color = `hsl(${(index * 43) % 360}, 60%, 55%)`;
  const buffer = await sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer();
  return { index, buffer };
}

async function assertApprovedA4LandscapeBoards(result, expectedCounts) {
  assert.equal(result.selectedSlideCount, new Set(result.selectedSlideIndexes).size);
  assert.deepEqual(
    result.boards.map((board) => board.slideIndexes.length),
    expectedCounts,
  );
  assert.deepEqual(
    result.boards.map((board) => board.mockupTemplateId),
    APPROVED_A4_LANDSCAPE_BODY_TEMPLATE_IDS,
  );
  assert.ok(result.boards.every((board) => (
    board.mockupTemplateVersion === APPROVED_A4_LANDSCAPE_TEMPLATE_VERSION
      && !board.mockupTemplateId.startsWith("legacy-")
  )));

  const usage = new Map(result.selectedSlideIndexes.map((index) => [index, 0]));
  for (const board of result.boards) {
    assert.deepEqual([board.width, board.height], [1600, 900]);
    assert.equal(new Set(board.slideIndexes).size, board.slideIndexes.length);
    assert.equal(board.slotAssignments.length, board.slideIndexes.length);
    for (const index of board.slideIndexes) {
      assert.ok(usage.has(index), `unexpected A4 landscape slide index ${index}`);
      usage.set(index, usage.get(index) + 1);
    }
    const metadata = await sharp(board.bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.deepEqual([metadata.width, metadata.height], [1600, 900]);
  }

  assert.ok([...usage.values()].every((count) => count > 0));
  assert.ok(Math.max(...usage.values()) - Math.min(...usage.values()) <= 1);
}

test("classifies only the four supported short-mockup ratios", () => {
  assert.equal(classifyShortMockupAspectRatio(16 / 9), "16:9");
  assert.equal(classifyShortMockupAspectRatio(4 / 3), "4:3");
  assert.equal(classifyShortMockupAspectRatio(297 / 210), "a4_landscape");
  assert.equal(classifyShortMockupAspectRatio(210 / 297), "a4_portrait");
  assert.equal(classifyShortMockupAspectRatio(1100 / 850), "unknown");
});

test("renders the approved 16:9 boards with only balanced cross-board reuse", async () => {
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
  assert.deepEqual(result.boards.map((board) => board.slideIndexes.length), [7, 7, 4, 8]);
  assert.deepEqual(result.boards.map((board) => [board.width, board.height]), [
    [1600, 900],
    [1600, 900],
    [1600, 900],
    [1600, 900],
  ]);
  const usage = new Map();
  for (const board of result.boards) {
    assert.equal(new Set(board.slideIndexes).size, board.slideIndexes.length);
    assert.equal(board.slotAssignments.length, board.slideIndexes.length);
    assert.ok(board.mockupTemplateId.startsWith("body-"));
    board.slideIndexes.forEach((index) => usage.set(index, (usage.get(index) || 0) + 1));
    const metadata = await sharp(board.bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, board.width);
    assert.equal(metadata.height, board.height);
  }
  assert.deepEqual([...usage.keys()].sort((a, b) => a - b), result.selectedSlideIndexes);
  assert.ok(Math.max(...usage.values()) - Math.min(...usage.values()) <= 1);
});

test("renders seven distinct 16:9 slides into the seven approved perspective slots", async () => {
  const colors = [
    { r: 245, g: 35, b: 35 },
    { r: 35, g: 210, b: 70 },
    { r: 35, g: 80, b: 235 },
    { r: 240, g: 205, b: 25 },
    { r: 220, g: 35, b: 205 },
    { r: 25, g: 205, b: 205 },
    { r: 235, g: 125, b: 25 },
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

test("renders approved A4 landscape short suites for 5, 6, 7, and 14 slides", async (t) => {
  const cases = [
    { slideCount: 5, expectedCounts: [5, 5, 4, 5] },
    { slideCount: 6, expectedCounts: [6, 6, 4, 6] },
    { slideCount: 7, expectedCounts: [7, 7, 4, 6] },
    { slideCount: 14, expectedCounts: [7, 7, 4, 6] },
  ];

  for (const { slideCount, expectedCounts } of cases) {
    await t.test(`${slideCount} slides`, async () => {
      const slides = await Promise.all(Array.from(
        { length: slideCount },
        (_, index) => sampleSlide(index, 297, 210),
      ));
      const result = await renderShortDocumentMockups({
        deckSlideCount: slideCount,
        aspectClass: "a4_landscape",
        slides,
      });
      assert.equal(result.mode, "short_psd");
      assert.equal(result.bodyBoardCount, 4);
      assert.equal(result.selectedSlideCount, slideCount);
      await assertApprovedA4LandscapeBoards(result, expectedCounts);
    });
  }
});

test("renders approved A4 landscape long helper suites for 18 and 24 slides", async (t) => {
  for (const slideCount of [18, 24]) {
    await t.test(`${slideCount} slides`, async () => {
      const slides = await Promise.all(Array.from(
        { length: slideCount },
        (_, index) => sampleSlide(index, 297, 210),
      ));
      const result = await renderApprovedTemplateBodyMockups({
        aspectClass: "a4_landscape",
        slides,
      });
      assert.equal(result.selectedSlideCount, slideCount);
      await assertApprovedA4LandscapeBoards(result, [7, 7, 4, 6]);
    });
  }
});

test("keeps all four boards non-empty for a five-slide short document", async () => {
  const slides = await Promise.all(Array.from({ length: 5 }, (_, index) => sampleSlide(index, 210, 297)));
  const result = await renderShortDocumentMockups({
    deckSlideCount: 5,
    aspectClass: "a4_portrait",
    slides,
  });
  assert.deepEqual(result.boards.map((board) => board.slideIndexes.length), [2, 1, 1, 1]);
  assert.deepEqual(result.boards.flatMap((board) => board.slideIndexes), [0, 1, 2, 3, 4]);
});

test("keeps every board non-empty across the five-to-seven-slide boundary", async () => {
  for (const aspectClass of ["16:9", "4:3", "a4_landscape", "a4_portrait"]) {
    for (let slideCount = 5; slideCount <= 7; slideCount += 1) {
      const landscape = aspectClass === "16:9" || aspectClass === "a4_landscape";
      const slides = await Promise.all(Array.from(
        { length: slideCount },
        (_, index) => sampleSlide(index, landscape ? 320 : 210, landscape ? 180 : 297),
      ));
      const result = await renderShortDocumentMockups({
        deckSlideCount: slideCount,
        aspectClass,
        slides,
      });
      assert.equal(result.boards.length, 4);
      assert.ok(result.boards.every((board) => board.slideIndexes.length > 0));
      if (aspectClass === "16:9" || aspectClass === "a4_landscape") {
        assert.deepEqual(
          result.boards.map((board) => board.slideIndexes.length),
          aspectClass === "16:9"
            ? [slideCount, slideCount, Math.min(4, slideCount), slideCount]
            : [slideCount, slideCount, Math.min(4, slideCount), Math.min(6, slideCount)],
        );
        assert.ok(result.boards.every((board) => (
          new Set(board.slideIndexes).size === board.slideIndexes.length
        )));
        assert.equal(new Set(result.boards.flatMap((board) => board.slideIndexes)).size, slideCount);
      } else {
        assert.equal(result.boards.flatMap((board) => board.slideIndexes).length, slideCount);
      }
    }
  }
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
