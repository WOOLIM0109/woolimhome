import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { pptxFixture } from './fixtures.test-support.mjs';
import { inspectPptx, sha256 } from './pptx-inspection.ts';
import { prepareLocalPptx } from './pipeline.ts';
import { selectPreparedSlides } from './slide-preparation.ts';

const automaticNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16];
const layoutOffsets = Object.fromEntries(Array.from({ length: 23 }, (_, index) => {
  const number = index + 1;
  return [number, [1, 10, 14].includes(number) ? 0 : number * 250000];
}));
const previews = inspection => inspection.slides.map(slide => ({
  sourceSlideNumber: slide.sourceSlideNumber, visualHash: `synthetic-preview-${slide.sourceSlideNumber}`, blank: false,
}));

// Deterministic local-only exporter. It exercises the real inspection, PNG
// validation, selection and work ledger without PowerPoint or customer files.
async function exportSyntheticSlides(input, { onSlide }) {
  await mkdir(input.outputDirectory, { recursive: true });
  const width = input.longEdge, height = Math.round(width * 9 / 16);
  const slides = [];
  for (const number of input.slideNumbers) {
    const file = path.join(input.outputDirectory, `synthetic-${number}-${input.longEdge}.png`);
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect x="${number * 7}" y="20" width="${50 + number * 3}" height="120" fill="#123456"/></svg>`)).png().toBuffer();
    await writeFile(file, png);
    const slide = { sourceSlideNumber: number, path: file, width, height };
    slides.push(slide);
    await onSlide(slide);
  }
  return { sourceHash: input.sourceHash, slides, slideWidth: 1280, slideHeight: 720 };
}

test('manual 10 and 14 enter an isolated prepared generation; omitted selection preserves the automatic baseline', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'woolim-manual-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'input', 'source.pptx');
  const original = await pptxFixture({ count: 23, layoutOffsets });
  await mkdir(path.dirname(sourcePath));
  await writeFile(sourcePath, original);
  const dependencies = {
    runtime: async () => ({ available: true, powerPointVersion: 'synthetic-only', registeredClass: 'stub',
      fontInventory: { families: [{ english: 'Arial', korean: null }], fingerprint: sha256('synthetic-fonts') } }),
    converterFingerprint: async () => sha256('synthetic-manual-converter'),
    exportSlides: exportSyntheticSlides,
  };
  const initialRoot = path.join(root, 'automatic'), manualRoot = path.join(root, 'manual');
  const automatic = await prepareLocalPptx({ sourcePath, workRoot: initialRoot }, dependencies);
  assert.deepEqual(automatic.selection.selected, automaticNumbers);
  assert.deepEqual(automatic.selection.reserves, [17, 18]);
  assert.equal(automatic.selection.slides.find(slide => slide.sourceSlideNumber === 10).disposition, 'candidate');
  assert.equal(automatic.selection.slides.find(slide => slide.sourceSlideNumber === 14).disposition, 'candidate');
  const initialRecordPath = path.join(initialRoot, 'builds', automatic.buildId, 'record.json');
  const initialRecord = await readFile(initialRecordPath);

  const selectedSlideNumbers = [1, 2, 3, 4, 5, 6, 10, 14];
  const manual = await prepareLocalPptx({ sourcePath, workRoot: manualRoot, selectedSlideNumbers }, dependencies);
  assert.equal(manual.status, 'ready_for_local_review');
  assert.notEqual(manual.buildId, automatic.buildId);
  assert.deepEqual(manual.selection.selected, selectedSlideNumbers);
  const record = JSON.parse(await readFile(path.join(manualRoot, 'builds', manual.buildId, 'record.json'), 'utf8'));
  assert.deepEqual(record.stages.slide_selection.data.selected, selectedSlideNumbers);
  for (const number of [10, 14]) assert.ok(record.artifacts[`highres:${number}`]);
  assert.deepEqual(await readFile(initialRecordPath), initialRecord);

  const restored = await prepareLocalPptx({ sourcePath, workRoot: manualRoot }, dependencies);
  assert.deepEqual(restored.selection, automatic.selection);
  assert.deepEqual(await readFile(sourcePath), original);
});

test('manual selection keeps damaged, missing-font, uninspectable and unreviewed PHOTO_DENSE slides excluded with holds', async () => {
  const inspection = await inspectPptx(await pptxFixture({ count: 16, fonts: { 3: 'Missing QA Font' },
    uninspectableSlides: [4], backgroundPictureKinds: { 5: 'photo' }, broken: [6] }), { installedFonts: ['Arial'] });
  const selection = selectPreparedSlides(inspection, previews(inspection), {
    selectedSlideNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  });
  assert.equal(selection.status, 'held');
  assert.deepEqual(selection.selected, [1, 2, 7, 8, 9, 10, 11, 12]);
  for (const [number, reason] of [[3, 'MISSING_FONTS'], [4, 'UNINSPECTABLE_OBJECT'], [5, 'PHOTO_DENSE'], [6, 'CORRUPT_SLIDE']]) {
    const slide = selection.slides.find(slide => slide.sourceSlideNumber === number);
    assert.equal(slide.disposition, 'excluded');
    assert.ok(slide.reasons.some(message => message.startsWith(reason)), `${number}: ${reason}`);
    assert.ok(selection.holds.some(message => message.startsWith(`${number}번`)));
  }
});

test('manual selection can include or omit the real first-slide cover without reinserting it', async () => {
  const inspection = await inspectPptx(await pptxFixture({ count: 23, layoutOffsets }), { installedFonts: ['Arial'] });
  const checks = previews(inspection);
  const withCover = selectPreparedSlides(inspection, checks, { selectedSlideNumbers: [1, 2, 3, 4, 5, 6, 10, 14] });
  assert.equal(withCover.status, 'ready_for_local_review');
  assert.equal(withCover.cover, 1);
  const withoutCover = selectPreparedSlides(inspection, checks, { selectedSlideNumbers: [2, 3, 4, 5, 6, 7, 10, 14] });
  assert.equal(withoutCover.status, 'ready_for_local_review');
  assert.equal(withoutCover.cover, 2);
  assert.deepEqual(withoutCover.selected, [2, 3, 4, 5, 6, 7, 10, 14]);
  assert.ok(!withoutCover.selected.includes(1));
});

test('selection manual flag records the override path even when no slide receives a manual reason', async () => {
  const inspection = await inspectPptx(await pptxFixture({ count: 9 }), { installedFonts: ['Arial'] });
  const checks = previews(inspection);
  assert.equal(selectPreparedSlides(inspection, checks).manual, false);
  const manual = selectPreparedSlides(inspection, checks, { selectedSlideNumbers: [] });
  assert.equal(manual.manual, true); assert.deepEqual(manual.selected, []);
  assert.ok(manual.slides.every(slide => !slide.reasons.includes('사용자 선별')));
});
