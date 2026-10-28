import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { pptxFixture } from './fixtures.test-support.mjs';
import { prepareLocalPptx } from './pipeline.ts';
import { sha256 } from './pptx-inspection.ts';
import { openPreparationWorkStore } from './work-store.ts';
import { exportLocalPowerPointSlides } from './powerpoint-adapter.ts';
import { getPreparationReview, preparePreparationReviewEvidence, readPreparationReviewEvidence, applyPreparationReview } from './preparation-review-service.ts';

const sourceRatio = [612.25, 858.8750393700788];
const runtime = () => ({ available: true, powerPointVersion: 'mock-only', registeredClass: 'stub',
  fontInventory: { families: [{ english: 'Arial', korean: null }], fingerprint: sha256('fixed-test-fonts') } });
function exporter({ wrongHash = false, wrongPage = false, outside = false, mutate, blank = false } = {}) {
  const calls = [];
  return { calls, run: async (input, { onSlide }) => {
    calls.push({ edge: input.longEdge, numbers: [...input.slideNumbers], width: input.expectedSlideWidth, height: input.expectedSlideHeight });
    const ratio = input.expectedSlideWidth / input.expectedSlideHeight;
    const width = Math.round(input.longEdge * Math.min(1, ratio)), height = Math.round(input.longEdge * Math.min(1, 1 / ratio));
    await mkdir(input.outputDirectory, { recursive: true });
    const slides = [];
    for (const n of input.slideNumbers) {
      const file = path.join(input.outputDirectory, outside ? `../outside-${n}.png` : `slide-${n}.png`);
      const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${blank ? '' : `<rect x="${n * 7}" y="20" width="${50 + n * 3}" height="120" fill="#123456"/>`}</svg>`)).png().toBuffer();
      await writeFile(file, png);
      if (mutate) await mutate();
      const slide = { sourceSlideNumber: n, path: file, width, height };
      slides.push(slide); await onSlide(slide);
    }
    return { sourceHash: wrongHash ? sha256('different-source') : input.sourceHash, slides,
      slideWidth: input.expectedSlideWidth * (wrongPage ? 1.02 : 1), slideHeight: input.expectedSlideHeight };
  } };
}
function dependencies(e) { return { runtime: async () => runtime(), converterFingerprint: async () => sha256('fixed-test-converter'), exportSlides: e.run }; }
async function fixture(t, options = {}) {
  const { sessionLength, ...pptxOptions } = options;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wpr-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  assert.ok(!sessionLength || temporary.length + 1 < sessionLength);
  const root = sessionLength ? path.join(temporary, 's'.repeat(sessionLength - temporary.length - 1)) : temporary;
  const sourcePath = path.join(root, 'input', 'source.pptx'), workRoot = path.join(root, 'w');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, await pptxFixture({ count: 9, ...pptxOptions }));
  const exp = exporter(), deps = dependencies(exp);
  const result = await prepareLocalPptx({ sourcePath, workRoot }, deps);
  const identity = { sourcePath, workRoot, workId: result.workId, buildId: result.buildId };
  return { root, sourcePath, workRoot, exp, deps, result, identity };
}
const proof = (view) => ({ buildId: view.buildId, revision: view.revision, sourceHash: view.sourceHash });
const visual = (row) => ({ sourceSlideNumber: row.sourceSlideNumber, slideContentHash: row.slideContentHash,
  previewHash: row.previewHash, imageHash: row.evidence?.imageHash, inspectedAtActualSize: true,
  reason: '실제 크기의 원본을 직접 확인한 합성 테스트입니다.' });
const actor = { reviewedBy: 'Synthetic local reviewer' };
async function ledger(f) {
  return JSON.parse(await readFile(path.join(f.workRoot, 'builds', f.result.buildId, 'record.json'), 'utf8'));
}
async function prepareEvidence(f, numbers = [1], exp = exporter()) {
  const before = await getPreparationReview(f.identity);
  return { before, after: await preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(before), slideNumbers: numbers }, dependencies(exp)), exp };
}

// Use the real adapter's fresh attempt directory and protocol validation. Only
// the PowerShell/COM process is replaced; no customer presentation is opened.
function adapterExporter({ failAt } = {}) {
  const calls = [];
  return { calls, run: (input, options) => exportLocalPowerPointSlides(input, { ...options, runProcess: async invocation => {
    const requestPath = invocation.args[invocation.args.indexOf('-RequestPath') + 1];
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    calls.push(request);
    assert.match(path.basename(request.outputDirectory), /^attempt-[a-f0-9-]{36}$/);
    assert.equal(path.dirname(request.outputDirectory), request.outputRoot);
    assert.deepEqual(await readdir(request.outputDirectory), [], 'every converter invocation starts in an empty directory');
    const copyPath = path.join(request.outputDirectory, `.source-copy-${'a'.repeat(32)}.pptx`);
    assert.ok(copyPath.length < 260, 'the converter source-copy path fits Windows MAX_PATH');
    await writeFile(copyPath, await readFile(request.sourcePath));
    const ratio = request.expectedSlideWidth / request.expectedSlideHeight;
    const width = Math.round(request.longEdge * Math.min(1, ratio)), height = Math.round(request.longEdge * Math.min(1, 1 / ratio));
    try {
      for (const n of request.slideNumbers) {
        if (n === failAt) await invocation.onStdoutLine(JSON.stringify({ type: 'error', code: 'SLIDE_EXPORT_FAILED', message: 'Injected synthetic export failure.' }));
        const temporary = path.join(request.outputDirectory, `slide-${String(n).padStart(4, '0')}.${'b'.repeat(32)}.tmp.png`);
        const file = path.join(request.outputDirectory, `slide-${String(n).padStart(4, '0')}.png`);
        assert.ok(temporary.length < 260, 'the converter temporary image path fits Windows MAX_PATH');
        const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect x="${n * 7}" y="20" width="${50 + n * 3}" height="120" fill="#123456"/></svg>`)).png().toBuffer();
        await writeFile(temporary, png); await rename(temporary, file);
        await invocation.onStdoutLine(JSON.stringify({ type: 'slide', sourceSlideNumber: n, path: file, width, height }));
      }
      await invocation.onStdoutLine(JSON.stringify({ type: 'complete', operation: 'export', sourceHash: request.sourceHash,
        outputDirectory: request.outputDirectory, slideCount: request.slideNumbers.length, sourceSlideNumbers: request.slideNumbers,
        slideWidth: request.expectedSlideWidth, slideHeight: request.expectedSlideHeight, exportWidth: width, exportHeight: height }));
      return { exitCode: 0, signal: null, stderr: '' };
    } finally { await rm(copyPath, { force: true }); }
  } }) };
}

test('six held PHOTO_DENSE slides prepare together at the office session depth with a fresh short adapter attempt', async t => {
  const numbers = [1, 2, 10, 11, 14, 23];
  const f = await fixture(t, { sessionLength: 80, count: 23, backgroundPictureKinds: Object.fromEntries(numbers.map(n => [n, 'photo'])) });
  assert.equal(f.root.length, 80);
  const attemptRoot = path.join(f.workRoot, 'builds', f.result.buildId, 'artifacts', 'attempts');
  assert.equal(attemptRoot.length, 145);
  const previous = path.join(attemptRoot, 'attempt-00000000-0000-4000-8000-000000000000');
  await mkdir(previous, { recursive: true }); await writeFile(path.join(previous, 'previous-attempt.txt'), 'keep prior attempt');
  const old = await ledger(f), exp = adapterExporter(), { before, after } = await prepareEvidence(f, numbers, exp);
  assert.deepEqual(before.slides.filter(slide => slide.artworkEligible).map(slide => slide.sourceSlideNumber), numbers);
  assert.equal(exp.calls.length, 1); assert.equal(exp.calls[0].outputRoot, attemptRoot);
  assert.equal(exp.calls[0].longEdge, 2400); assert.deepEqual(exp.calls[0].slideNumbers, numbers);
  assert.ok(after.revision > before.revision);
  assert.ok(after.slides.every(slide => slide.evidence?.width === 2400 && slide.evidence.height === 1350));
  assert.deepEqual(Object.keys((await ledger(f)).artifacts).filter(key => !old.artifacts[key]).sort(), numbers.map(n => `preparation-review-evidence:${n}`).sort());
  assert.equal(await readFile(path.join(previous, 'previous-attempt.txt'), 'utf8'), 'keep prior attempt');
  assert.deepEqual((await ledger(f)).stages, old.stages);
});

test('single-slide preparation succeeds repeatedly at the office depth without reusing a nonempty attempt', async t => {
  const f = await fixture(t, { sessionLength: 80, backgroundPictureKinds: { 1: 'photo', 2: 'photo' } });
  const exp = adapterExporter(), first = await prepareEvidence(f, [1], exp);
  assert.ok(first.after.slides.find(slide => slide.sourceSlideNumber === 1).evidence);
  assert.equal(first.after.slides.find(slide => slide.sourceSlideNumber === 2).evidence, null);
  const second = await prepareEvidence(f, [2], exp);
  assert.ok(second.after.slides.every(slide => slide.evidence));
  assert.equal(exp.calls.length, 2); assert.notEqual(exp.calls[0].outputDirectory, exp.calls[1].outputDirectory);
  assert.deepEqual(exp.calls.map(call => call.slideNumbers), [[1], [2]]);
  assert.ok(second.after.revision > first.after.revision);
});

test('oversized evidence output is rejected before invoking the PowerPoint exporter or changing the ledger', async t => {
  const f = await fixture(t, { ratio: sourceRatio });
  // The normal pipeline already limits new work roots. Reproduce a copied local
  // session whose evidence output would exceed MAX_PATH after adapter suffixes.
  const workRoot = path.join(f.root, 'l'.repeat(110 - f.root.length - 1));
  await cp(f.workRoot, workRoot, { recursive: true, errorOnExist: true, force: false });
  const copied = { ...f, workRoot, identity: { ...f.identity, workRoot } };
  const before = await ledger(copied), exp = adapterExporter();
  await assert.rejects(prepareEvidence(copied, [1], exp), /PREPARATION_EVIDENCE_PATH_TOO_LONG/);
  assert.equal(exp.calls.length, 0); assert.deepEqual(await ledger(copied), before);
});

test('one failed full-size slide registers no evidence from the batch and keeps cached previews unchanged', async t => {
  const f = await fixture(t, { backgroundPictureKinds: { 1: 'photo', 2: 'photo' } });
  const before = await ledger(f), exp = adapterExporter({ failAt: 2 });
  await assert.rejects(prepareEvidence(f, [1, 2], exp), error => error.code === 'SLIDE_EXPORT_FAILED');
  assert.equal(exp.calls.length, 1); assert.equal(exp.calls[0].longEdge, 2400);
  assert.deepEqual(await ledger(f), before);
  assert.ok((await getPreparationReview(f.identity)).slides.every(slide => slide.evidence === null));
});

test('one failed initial preview slide registers neither preview nor full-size evidence for that batch', async t => {
  const f = await fixture(t, { ratio: sourceRatio, backgroundPictureKinds: { 1: 'photo', 2: 'photo' } });
  const before = await ledger(f), exp = adapterExporter({ failAt: 2 });
  await assert.rejects(prepareEvidence(f, [1, 2], exp), error => error.code === 'SLIDE_EXPORT_FAILED');
  assert.equal(exp.calls.length, 1); assert.equal(exp.calls[0].longEdge, 800);
  assert.deepEqual(await ledger(f), before);
  assert.ok((await getPreparationReview(f.identity)).slides.every(slide => slide.previewHash === null && slide.evidence === null));
});

test('held custom portrait get is read-only and gives bounded metadata without raw text, paths or exports', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio });
  assert.equal(f.result.status, 'held'); assert.equal(f.exp.calls.length, 0);
  const before = await ledger(f), view = await getPreparationReview(f.identity);
  assert.equal(view.customPortrait.allowed, true); assert.equal(view.customPortrait.currentChoice, false);
  assert.equal(view.customPortrait.reviewSlideNumber, 1); assert.equal(view.slides.length, 1);
  assert.equal(view.slides[0].previewHash, null); assert.equal(view.slides[0].evidence, null);
  assert.equal(view.source.aspect, 'unknown'); assert.equal(view.source.pageSizeVariant, 'custom');
  assert.match(view.customPortrait.reason, /3%/);
  assert.equal(view.localOnly, true); assert.deepEqual(await ledger(f), before);
  assert.doesNotMatch(JSON.stringify(view), /sourcePath|workRoot|source\.pptx|Local QA slide|no customer data|redaction-state|publication/);
});

test('explicit format evidence renders only requested source-ratio 800/2400 images and changes no selection, redaction or mockup state', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio });
  const source = await readFile(f.sourcePath), oldRecord = await ledger(f), oldWork = await readFile(path.join(f.workRoot, 'work.json'));
  const { before, after, exp } = await prepareEvidence(f);
  assert.deepEqual(exp.calls.map(({ edge, numbers }) => ({ edge, numbers })), [{ edge: 800, numbers: [1] }, { edge: 2400, numbers: [1] }]);
  assert.ok(exp.calls.every((call) => call.width === f.result.inspection.width && call.height === f.result.inspection.height));
  const row = after.slides[0]; assert.ok(row.previewHash); assert.ok(row.evidence.imageHash);
  assert.equal(row.evidence.height, 2400); assert.ok(row.evidence.width < 2400);
  assert.ok(after.revision > before.revision); assert.equal(after.sourceHash, before.sourceHash);
  assert.equal((await ledger(f)).selectionRevision, oldRecord.selectionRevision);
  assert.deepEqual((await ledger(f)).stages, oldRecord.stages);
  assert.equal((await ledger(f)).stages.high_resolution_conversion, undefined);
  assert.deepEqual(await readFile(path.join(f.workRoot, 'work.json')), oldWork);
  assert.deepEqual(await readFile(f.sourcePath), source);
  const newKeys = Object.keys((await ledger(f)).artifacts).filter((key) => !oldRecord.artifacts[key]);
  assert.deepEqual(newKeys.sort(), ['preparation-review-evidence:1', 'preparation-review-preview:1']);
  const bytes = await readPreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(after), sourceSlideNumber: 1, imageHash: row.evidence.imageHash });
  assert.equal(sha256(bytes), row.evidence.imageHash);
  const repeated = exporter();
  const same = await preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(after), slideNumbers: [1] }, dependencies(repeated));
  assert.deepEqual(same, after); assert.equal(repeated.calls.length, 0);
  await assert.rejects(readPreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(before), sourceSlideNumber: 1, imageHash: row.evidence.imageHash }), /PREPARATION_REVIEW_STALE/);
});

test('apply validates source, both image hashes, full-size inspection and reason; returns options without a write or implicit approval', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), { after } = await prepareEvidence(f);
  const input = { expectedCurrentBuild: proof(after), sourceFormatChoice: { ...visual(after.slides[0]), kind: 'custom_portrait_to_a4' }, artworkReviews: [] };
  const before = await ledger(f), options = await applyPreparationReview(f.identity, input, actor);
  assert.deepEqual(options.expectedCurrentBuild, proof(after));
  assert.equal(options.sourceFormatChoice.kind, 'custom_portrait_to_a4'); assert.equal(options.sourceFormatChoice.sourceHash, after.sourceHash);
  assert.equal(options.sourceFormatChoice.reviewedBy, actor.reviewedBy); assert.equal(options.artworkReviews, undefined);
  assert.deepEqual(await applyPreparationReview(f.identity, input, actor), options);
  assert.deepEqual(await ledger(f), before); assert.equal((await getPreparationReview(f.identity)).customPortrait.currentChoice, false);
  for (const change of [{ previewHash: sha256('bad') }, { imageHash: sha256('bad') }, { slideContentHash: sha256('bad') },
    { inspectedAtActualSize: false }, { reason: '' }, { reason: 'bad\nreason' }, { kind: 'landscape' }, { sourcePath: 'injected' }]) {
    await assert.rejects(applyPreparationReview(f.identity, { ...input, sourceFormatChoice: { ...input.sourceFormatChoice, ...change } }, actor));
  }
  await assert.rejects(applyPreparationReview(f.identity, { ...input, expectedCurrentBuild: { ...proof(after), sourceHash: sha256('wrong') } }, actor), /PREPARATION_REVIEW_STALE/);
  assert.deepEqual(await ledger(f), before);
});

test('PHOTO_DENSE review reuses private preview, renders only its missing full-size evidence and permits only explicit abstract classification', async (t) => {
  const f = await fixture(t, { backgroundPictureKinds: { 1: 'photo' } });
  assert.notEqual(f.result.selection.cover, 1);
  const { after, exp } = await prepareEvidence(f);
  assert.deepEqual(exp.calls.map(({ edge, numbers }) => ({ edge, numbers })), [{ edge: 2400, numbers: [1] }]);
  const input = { expectedCurrentBuild: proof(after), artworkReviews: [{ ...visual(after.slides[0]), classification: 'abstract_graphic' }] };
  const before = await ledger(f), options = await applyPreparationReview(f.identity, input, actor);
  assert.equal(options.artworkReviews[0].previewHash, before.artifacts['preview:1'].sha256);
  assert.equal(options.artworkReviews[0].inspectedAtFullResolution, true);
  assert.deepEqual(await ledger(f), before);
  for (const update of [{ classification: 'photo' }, { sourceSlideNumber: 2 }, { inspectedAtActualSize: false }]) {
    await assert.rejects(applyPreparationReview(f.identity, { ...input, artworkReviews: [{ ...input.artworkReviews[0], ...update }] }, actor));
  }
  await assert.rejects(applyPreparationReview(f.identity, { ...input, artworkReviews: [input.artworkReviews[0], input.artworkReviews[0]] }, actor), /ARTWORK_NOT_ALLOWED/);
  const nextOptions = { ...options }; delete nextOptions.expectedCurrentBuild;
  const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: path.join(f.root, 'next'), ...nextOptions }, dependencies(exporter()));
  assert.equal(next.status, 'ready_for_local_review'); assert.equal(next.selection.cover, 1);
  assert.deepEqual(await ledger(f), before);
  assert.equal((await getPreparationReview(f.identity)).slides[0].artworkReviewed, false);
});

test('font and table exclusions do not gain artwork approval; unsupported landscape does not gain a format override', async (t) => {
  const f = await fixture(t, { backgroundPictureKinds: { 1: 'photo' }, fonts: { 1: 'Missing synthetic font' } });
  const { after } = await prepareEvidence(f);
  assert.equal(after.slides[0].artworkEligible, false); assert.ok(after.slides[0].reasons.includes('MISSING_FONTS'));
  await assert.rejects(applyPreparationReview(f.identity, { expectedCurrentBuild: proof(after), artworkReviews: [{ ...visual(after.slides[0]), classification: 'abstract_graphic' }] }, actor), /ARTWORK_NOT_ALLOWED/);
  const wide = await fixture(t, { ratio: [4, 3] }), view = await getPreparationReview(wide.identity);
  assert.equal(view.customPortrait.allowed, false); assert.deepEqual(view.slides, []);
  await assert.rejects(preparePreparationReviewEvidence(wide.identity, { expectedCurrentBuild: proof(view), slideNumbers: [1] }, dependencies(exporter())), /SLIDE_NOT_ALLOWED/);
  assert.equal(wide.exp.calls.length, 0); assert.equal((await ledger(wide)).stages.high_resolution_conversion, undefined);
  const table = await fixture(t, { backgroundPictureKinds: { 1: 'photo' }, tableFonts: { 1: 'Arial' }, denseTables: [1] });
  const tableEvidence = await prepareEvidence(table);
  assert.equal(tableEvidence.after.slides[0].artworkEligible, false);
  await assert.rejects(applyPreparationReview(table.identity, { expectedCurrentBuild: proof(tableEvidence.after),
    artworkReviews: [{ ...visual(tableEvidence.after.slides[0]), classification: 'abstract_graphic' }] }, actor), /ARTWORK_NOT_ALLOWED/);
});

test('isolated custom portrait and artwork preparation retains raw ratio; subsequent review preserves prior verified choices', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio, count: 10, backgroundPictureKinds: { 1: 'photo', 2: 'photo' } });
  const { after } = await prepareEvidence(f, [1]);
  const options = await applyPreparationReview(f.identity, { expectedCurrentBuild: proof(after),
    sourceFormatChoice: { ...visual(after.slides[0]), kind: 'custom_portrait_to_a4' },
    artworkReviews: [{ ...visual(after.slides[0]), classification: 'abstract_graphic' }] }, actor);
  const nextOptions = { ...options }; delete nextOptions.expectedCurrentBuild;
  const nextRoot = path.join(f.root, 'generation-two'), exp = exporter();
  const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: nextRoot, ...nextOptions }, dependencies(exp));
  assert.equal(next.status, 'ready_for_local_review'); assert.equal(next.selection.cover, 1);
  assert.equal(next.inspection.aspect, 'unknown'); assert.equal(next.inspection.width, f.result.inspection.width);
  assert.equal(next.inspection.height, f.result.inspection.height);
  assert.ok(exp.calls.every((call) => call.width === f.result.inspection.width && call.height === f.result.inspection.height));
  const second = { ...f, workRoot: nextRoot, result: next,
    identity: { sourcePath: f.sourcePath, workRoot: nextRoot, workId: next.workId, buildId: next.buildId } };
  const secondEvidence = await prepareEvidence(second, [2]);
  assert.equal(secondEvidence.after.customPortrait.currentChoice, true);
  assert.equal(secondEvidence.after.slides.find((slide) => slide.sourceSlideNumber === 1).artworkReviewed, true);
  const secondOptions = await applyPreparationReview(second.identity, { expectedCurrentBuild: proof(secondEvidence.after),
    artworkReviews: [{ ...visual(secondEvidence.after.slides.find((slide) => slide.sourceSlideNumber === 2)), classification: 'abstract_graphic' }] }, actor);
  assert.deepEqual(secondOptions.sourceFormatChoice, options.sourceFormatChoice);
  assert.deepEqual(secondOptions.artworkReviews.map((review) => review.sourceSlideNumber), [1, 2]);
  assert.deepEqual(secondOptions.artworkReviews[0], options.artworkReviews[0]);
  assert.equal((await getPreparationReview(f.identity)).customPortrait.currentChoice, false);
  assert.equal((await getPreparationReview(f.identity)).slides[0].artworkReviewed, false);
});

test('missing full-size evidence, duplicate/unknown slides, extra browser fields and absent decisions fail closed', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), view = await getPreparationReview(f.identity), expectedCurrentBuild = proof(view);
  for (const slideNumbers of [[], [1, 1], [99], ['1'], Array.from({ length: 21 }, (_, index) => index + 1)]) {
    await assert.rejects(preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild, slideNumbers }, dependencies(exporter())));
  }
  await assert.rejects(preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild, slideNumbers: [1], sourcePath: 'injected' }, dependencies(exporter())), /INVALID/);
  await assert.rejects(applyPreparationReview(f.identity, { expectedCurrentBuild, artworkReviews: [] }, actor), /NO_CHANGES/);
  await assert.rejects(applyPreparationReview(f.identity, { expectedCurrentBuild, sourceFormatChoice: { ...visual(view.slides[0]), previewHash: sha256('claimed'), imageHash: sha256('claimed'), kind: 'custom_portrait_to_a4' }, artworkReviews: [] }, actor), /EVIDENCE_STALE/);
  assert.equal((await ledger(f)).revision, view.revision);
});

test('changed source, corrupted registered images and stale build identity block get/read/apply rather than fallback', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), { after } = await prepareEvidence(f);
  await assert.rejects(getPreparationReview({ ...f.identity, workId: '00000000-0000-4000-8000-000000000000' }), /STALE/);
  const source = await readFile(f.sourcePath); await writeFile(f.sourcePath, Buffer.concat([source, Buffer.from('changed')]));
  await assert.rejects(getPreparationReview(f.identity), /SOURCE_CHANGED/); await writeFile(f.sourcePath, source);
  const record = await ledger(f), artifact = record.artifacts['preparation-review-evidence:1'];
  await writeFile(path.join(f.workRoot, 'builds', f.result.buildId, 'artifacts', artifact.relativePath), 'synthetic-corruption');
  await assert.rejects(getPreparationReview(f.identity), /EVIDENCE_STALE/);
  await assert.rejects(readPreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(after), sourceSlideNumber: 1, imageHash: after.slides[0].evidence.imageHash }), /EVIDENCE_STALE/);
});

test('bad exporter batch metadata/path/blank output is not registered as evidence', async (t) => {
  for (const options of [{ wrongHash: true }, { wrongPage: true }, { outside: true }, { blank: true }]) {
    const f = await fixture(t, { ratio: sourceRatio }), before = await ledger(f), view = await getPreparationReview(f.identity);
    await assert.rejects(preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(view), slideNumbers: [1] }, dependencies(exporter(options))));
    assert.deepEqual(await ledger(f), before);
  }
});

test('source or converter/font changes during explicit evidence preparation cannot produce reusable proof', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), view = await getPreparationReview(f.identity), old = await ledger(f);
  const changedEnvironment = { ...dependencies(exporter()), converterFingerprint: async () => sha256('new-converter') };
  await assert.rejects(preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(view), slideNumbers: [1] }, changedEnvironment), /ENVIRONMENT_CHANGED/);
  assert.deepEqual(await ledger(f), old);
  const mutate = async () => writeFile(f.sourcePath, 'changed during export');
  await assert.rejects(preparePreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(view), slideNumbers: [1] }, dependencies(exporter({ mutate }))), /SOURCE_CHANGED/);
  assert.deepEqual(await ledger(f), old);
});

test('pipeline CAS rejects stale revision/source/build before beginOrResumeBuild; a matching proof still follows the normal hold', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), view = await getPreparationReview(f.identity), old = await ledger(f);
  const work = await readFile(path.join(f.workRoot, 'work.json'));
  for (const expectedCurrentBuild of [{ ...proof(view), revision: view.revision + 1 }, { ...proof(view), sourceHash: sha256('other') },
    { ...proof(view), buildId: '00000000-0000-4000-8000-000000000000' }, { ...proof(view), untrusted: true }, null]) {
    const exp = exporter();
    await assert.rejects(prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: f.workRoot, expectedCurrentBuild }, dependencies(exp)), /PREPARATION_REVIEW_STALE/);
    assert.equal(exp.calls.length, 0); assert.deepEqual(await ledger(f), old); assert.deepEqual(await readFile(path.join(f.workRoot, 'work.json')), work);
  }
  const exp = exporter(), matched = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: f.workRoot, expectedCurrentBuild: proof(view) }, dependencies(exp));
  assert.equal(matched.status, 'held'); assert.equal(exp.calls.length, 0); assert.equal(matched.buildId, f.result.buildId);
});

test('pipeline CAS rechecks store-locked revision after runtime work, and never mutates the newer revision', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), view = await getPreparationReview(f.identity);
  let expectedLedger;
  const deps = { ...dependencies(exporter()), runtime: async () => {
    const store = await openPreparationWorkStore({ root: f.workRoot });
    try {
      const build = await store.readBuild(f.result.buildId), relativePath = 'concurrent-review.json';
      await writeFile(await store.prepareArtifactPath(build.buildId, relativePath), '{}');
      await store.recordArtifact({ buildId: build.buildId, key: 'concurrent-review', expectedRevision: build.revision, relativePath });
    } finally { await store.release(); }
    expectedLedger = await ledger(f); return runtime();
  } };
  await assert.rejects(prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: f.workRoot, expectedCurrentBuild: proof(view) }, deps), /PREPARATION_REVIEW_STALE/);
  assert.deepEqual(await ledger(f), expectedLedger);
});

test('pipeline CAS detects a source replacement after initial read but before the store lock', async (t) => {
  const f = await fixture(t, { ratio: sourceRatio }), view = await getPreparationReview(f.identity), before = await ledger(f);
  const deps = { ...dependencies(exporter()), runtime: async () => { await writeFile(f.sourcePath, 'replaced while inspecting runtime'); return runtime(); } };
  await assert.rejects(prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: f.workRoot, expectedCurrentBuild: proof(view) }, deps), /PREPARATION_REVIEW_STALE/);
  assert.deepEqual(await ledger(f), before);
});

test('all preparation review actions operate with network forbidden', async (t) => {
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
  t.after(() => { globalThis.fetch = oldFetch; });
  const f = await fixture(t, { ratio: sourceRatio }), { after } = await prepareEvidence(f);
  await readPreparationReviewEvidence(f.identity, { expectedCurrentBuild: proof(after), sourceSlideNumber: 1, imageHash: after.slides[0].evidence.imageHash });
  await applyPreparationReview(f.identity, { expectedCurrentBuild: proof(after), sourceFormatChoice: { ...visual(after.slides[0]), kind: 'custom_portrait_to_a4' }, artworkReviews: [] }, actor);
});

test('selection view includes every source slide with its existing score, disposition, exclusions and verified thumbnail hash', async t => {
  const f = await fixture(t, { count: 23, hidden: [3], fonts: { 5: 'Missing synthetic font' },
    uninspectableSlides: [7], backgroundPictureKinds: { 9: 'photo' } });
  const before = await ledger(f), view = await getPreparationReview(f.identity);
  assert.equal(view.slideSelection.minimum, f.result.selection.minimum);
  assert.deepEqual(view.slideSelection.slides.map(slide => slide.sourceSlideNumber), Array.from({ length: 23 }, (_, index) => index + 1));
  for (const row of view.slideSelection.slides) {
    const existing = f.result.selection.slides.find(slide => slide.sourceSlideNumber === row.sourceSlideNumber);
    assert.equal(row.disposition, existing.disposition); assert.equal(row.score, existing.score);
    assert.ok(existing.reasons.every(reason => row.reasons.includes(reason)));
    assert.equal(row.previewHash, before.artifacts[`preview:${row.sourceSlideNumber}`]?.sha256 ?? null);
  }
  for (const number of [3, 5, 7, 9]) assert.equal(view.slideSelection.slides.find(slide => slide.sourceSlideNumber === number).disposition, 'excluded');
  assert.match(view.slideSelection.slides.find(slide => slide.sourceSlideNumber === 5).reasons.join(' '), /MISSING_FONTS/);
  assert.match(view.slideSelection.slides.find(slide => slide.disposition === 'candidate').reasons.join(' '), /같은 배치/);
  assert.deepEqual(await ledger(f), before); assert.equal(f.exp.calls.length, 2);
});

test('selection-only apply carries 10 and 14 into a new preparation and the first slide remains optional', async t => {
  const f = await fixture(t, { count: 23 }), view = await getPreparationReview(f.identity), before = await ledger(f);
  for (const selectedSlideNumbers of [[1, 2, 3, 4, 5, 6, 10, 14], [2, 3, 4, 5, 6, 7, 10, 14]]) {
    const options = await applyPreparationReview(f.identity, { expectedCurrentBuild: proof(view), artworkReviews: [], selectedSlideNumbers }, actor);
    assert.deepEqual(options.selectedSlideNumbers, selectedSlideNumbers);
    const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: path.join(f.root, `manual-${selectedSlideNumbers[0]}`),
      selectedSlideNumbers: options.selectedSlideNumbers }, dependencies(exporter()));
    assert.equal(next.status, 'ready_for_local_review'); assert.deepEqual(next.selection.selected, selectedSlideNumbers);
    assert.equal(next.selection.selected.includes(1), selectedSlideNumbers.includes(1));
    assert.ok(next.selection.selected.includes(10)); assert.ok(next.selection.selected.includes(14));
  }
  assert.deepEqual(await ledger(f), before);
});

test('empty manual selection requests the identical automatic result and malformed numbers are rejected by the service', async t => {
  const f = await fixture(t, { count: 18 }), view = await getPreparationReview(f.identity), before = await ledger(f);
  const input = { expectedCurrentBuild: proof(view), artworkReviews: [], selectedSlideNumbers: [] };
  const options = await applyPreparationReview(f.identity, input, actor);
  assert.equal(options.selectedSlideNumbers, undefined);
  const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: path.join(f.root, 'automatic'),
    selectedSlideNumbers: options.selectedSlideNumbers }, dependencies(exporter()));
  assert.deepEqual(next.selection, f.result.selection);
  for (const selectedSlideNumbers of [[1, 1], [1.5], ['1'], [0], [-1], [19], [Number.MAX_SAFE_INTEGER + 1], null, '1']) {
    await assert.rejects(applyPreparationReview(f.identity, { ...input, selectedSlideNumbers }, actor), /PREPARATION_REVIEW_INVALID_SLIDES/);
  }
  await assert.rejects(applyPreparationReview(f.identity, { expectedCurrentBuild: proof(view), artworkReviews: [] }, actor), /NO_CHANGES/);
  assert.deepEqual(await ledger(f), before);
});

test('manual excluded slide remains excluded and leaves the existing hold instead of gaining an override', async t => {
  const f = await fixture(t, { count: 18, fonts: { 10: 'Missing synthetic font' } }), view = await getPreparationReview(f.identity);
  const selectedSlideNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 10];
  const options = await applyPreparationReview(f.identity, { expectedCurrentBuild: proof(view), artworkReviews: [], selectedSlideNumbers }, actor);
  const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: path.join(f.root, 'held-manual'),
    selectedSlideNumbers: options.selectedSlideNumbers }, dependencies(exporter()));
  assert.equal(next.status, 'held'); assert.equal(next.selection.selected.includes(10), false);
  assert.equal(next.selection.slides.find(slide => slide.sourceSlideNumber === 10).disposition, 'excluded');
  assert.ok(next.selection.holds.some(reason => reason.includes('10번') && reason.includes('폰트')));
});

test('manual selection preserves new and existing verified format and artwork reasons and confirmations', async t => {
  const f = await fixture(t, { ratio: sourceRatio, count: 10, backgroundPictureKinds: { 1: 'photo' } });
  const { after } = await prepareEvidence(f), selectedSlideNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  const options = await applyPreparationReview(f.identity, { expectedCurrentBuild: proof(after), selectedSlideNumbers,
    sourceFormatChoice: { ...visual(after.slides[0]), kind: 'custom_portrait_to_a4' },
    artworkReviews: [{ ...visual(after.slides[0]), classification: 'abstract_graphic' }] }, actor);
  assert.equal(options.sourceFormatChoice.reason, visual(after.slides[0]).reason);
  assert.equal(options.artworkReviews[0].reason, visual(after.slides[0]).reason);
  assert.equal(options.artworkReviews[0].inspectedAtFullResolution, true);
  const nextOptions = { ...options }; delete nextOptions.expectedCurrentBuild;
  const nextRoot = path.join(f.root, 'reviewed-manual');
  const next = await prepareLocalPptx({ sourcePath: f.sourcePath, workRoot: nextRoot, ...nextOptions }, dependencies(exporter()));
  assert.equal(next.status, 'ready_for_local_review'); assert.deepEqual(next.selection.selected, selectedSlideNumbers);
  const identity = { sourcePath: f.sourcePath, workRoot: nextRoot, workId: next.workId, buildId: next.buildId };
  const nextView = await getPreparationReview(identity);
  const reapplied = await applyPreparationReview(identity, { expectedCurrentBuild: proof(nextView), artworkReviews: [],
    selectedSlideNumbers: [2, 3, 4, 5, 6, 7, 8, 9] }, actor);
  assert.deepEqual(reapplied.sourceFormatChoice, options.sourceFormatChoice);
  assert.deepEqual(reapplied.artworkReviews, options.artworkReviews);
  assert.equal(nextView.customPortrait.currentChoice, true); assert.equal(nextView.slides[0].artworkReviewed, true);
});
