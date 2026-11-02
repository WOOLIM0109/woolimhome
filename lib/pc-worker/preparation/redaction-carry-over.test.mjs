import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { openPreparationWorkStore } from './work-store.ts';
import {
  initializeLocalRedactions, getLocalRedactionSlide, saveLocalRedactionSlide,
  renderLocalRedactionSlide, approveLocalRedactionSlide, readSafeRedactedSlide, archiveSavedLocalRedactions,
} from './redaction-service.ts';
import { redactionHash } from './redaction-renderer.ts';
import { readRedactionCarry, writeRedactionCarry } from './redaction-carry-store.ts';

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'woolim-carry-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const width = 160, height = 90;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 17) % 251;
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return { temporary, png, carryStoreRoot: path.join(temporary, 'private-home', 'WoolimWorker', 'redaction-carry') };
}

async function build(f, name, { png = f.png, source = 'SYNTHETIC CARRY SOURCE', settings = name, candidatePrefix = '' } = {}) {
  const root = path.join(f.temporary, name), sourceHash = redactionHash(source);
  const store = await openPreparationWorkStore({ root });
  let opened;
  try {
    opened = await store.beginOrResumeBuild({ expectedWorkRevision: null, fingerprint: {
      source: { sha256: sourceHash, bytes: Buffer.byteLength(source) },
      conversionSettingsFingerprint: settings, fontFingerprint: 'synthetic-fonts',
    } });
    let current = opened.build;
    const buildId = current.buildId;
    current = await store.completeStage({ buildId, stage: 'source_inspection', expectedRevision: current.revision,
      inputFingerprint: 'synthetic-inspection', data: { sourceHash, slides: [{ sourceSlideNumber: 1, contentHash: redactionHash('synthetic-slide') }] } });
    current = await store.completeStage({ buildId, stage: 'preview_generation', expectedRevision: current.revision,
      inputFingerprint: 'synthetic-preview' });
    current = await store.recordSelection({ buildId, expectedRevision: current.revision, expectedSelectionRevision: 0,
      selectionFingerprint: 'synthetic-selection', data: { selected: [1], reserves: [], status: 'ready_for_local_review' } });
    const relativePath = 'highres/1.png';
    await writeFile(await store.prepareArtifactPath(buildId, relativePath), png);
    current = await store.recordArtifact({ buildId, key: 'highres:1', relativePath, expectedRevision: current.revision });
    await store.completeStage({ buildId, stage: 'high_resolution_conversion', expectedRevision: current.revision,
      inputFingerprint: 'synthetic-highres', artifactKeys: ['highres:1'] });
  } finally { await store.release(); }
  const detection = { sourceSlideNumber: 1, sourceHash, slideContentHash: redactionHash('synthetic-slide'), warnings: [], candidates: [
    { id: `${candidatePrefix}mandatory-email`, category: 'email', required: true, reason: 'CONTACT_TEXT', rect: { x: .1, y: .1, width: .2, height: .1 } },
    { id: `${candidatePrefix}optional-name`, category: 'name', required: false, reason: 'NAME_TEXT', rect: { x: .6, y: .1, width: .2, height: .1 } },
  ] };
  return { root, buildId: opened.build.buildId, workId: opened.work.workId, sourceSlideNumber: 1,
    carryStoreRoot: f.carryStoreRoot, detections: [detection], sourceFingerprint: { sha256: sourceHash, bytes: Buffer.byteLength(source) } };
}

function carryKey(identity, png) {
  return { root: identity.carryStoreRoot, workRoot: identity.root,
    sourceFingerprint: identity.sourceFingerprint, sourceHash: redactionHash(png) };
}

async function initialize(identity) {
  await initializeLocalRedactions(identity);
  return getLocalRedactionSlide(identity);
}

async function save(identity, state, label = 'first') {
  return saveLocalRedactionSlide({ ...identity, expectedRevision: state.revision,
    regions: [...state.regions.filter(region => region.candidateId),
      { id: `manual-${label}`, rect: { x: .35, y: .4, width: .2, height: .2 }, mode: 'blur' }],
    exceptions: [{ candidateId: 'optional-name', actor: `synthetic-${label}`, reason: `Synthetic public permission ${label}` }],
    review: { reviewer: `synthetic-${label}`, originalInspected: true, layoutAcceptable: true } });
}

async function approve(identity, state) {
  const rendered = await renderLocalRedactionSlide({ ...identity, expectedRevision: state.revision });
  return approveLocalRedactionSlide({ ...identity, expectedRevision: rendered.revision,
    outputHash: rendered.output.sha256, reviewer: state.review.reviewer, outputInspected: true });
}

test('same source and PNG carry rectangles, public exceptions and original approval into another work and build', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  const approved = await approve(old, await save(old, await initialize(old)));
  const oldPng = await readSafeRedactedSlide(old);
  await rm(old.root, { recursive: true, force: true });

  const next = await build(f, 'next', { settings: 'different-conversion-settings' });
  assert.notEqual(next.workId, old.workId);
  assert.notEqual(next.buildId, old.buildId);
  let carried = await initialize(next);
  assert.deepEqual(carried.regions, approved.regions);
  assert.deepEqual(carried.exceptions, approved.exceptions);
  assert.deepEqual(carried.review, approved.review);
  assert.equal(carried.carryOver.savedAt, approved.savedAt);
  assert.equal(carried.carryOver.approvedAt, approved.output.approvedAt);
  assert.equal(carried.carryOver.approvedBy, approved.output.approvedBy);
  assert.equal(carried.workId, next.workId);
  assert.equal(carried.buildId, next.buildId);
  if (!carried.output) carried = await renderLocalRedactionSlide({ ...next, expectedRevision: carried.revision });
  assert.equal(carried.output.sha256, approved.output.sha256);
  assert.deepEqual(await readSafeRedactedSlide(next, { allowUnapproved: true }), oldPng);
  assert.equal(carried.output.approvedAt, null);
  assert.equal(carried.output.approvedBy, null);
  await assert.rejects(readSafeRedactedSlide(next), /NOT_APPROVED/);
  const restoredAgain = await initialize(next);
  assert.deepEqual(restoredAgain.carryOver, carried.carryOver);
  assert.equal(restoredAgain.revision, carried.revision);
});

test('identical PNGs reconnect changed candidate IDs only to the same category and rectangle', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  const approved = await approve(old, await save(old, await initialize(old)));
  const next = await build(f, 'next', { candidatePrefix: 'new-' });
  const state = await initialize(next);
  assert.deepEqual(state.regions, approved.regions.map(region => region.candidateId
    ? { ...region, candidateId: `new-${region.candidateId}` } : region));
  assert.deepEqual(state.exceptions, approved.exceptions.map(exception => ({ ...exception, candidateId: `new-${exception.candidateId}` })));
  assert.deepEqual(state.review, approved.review);
  assert.equal(state.carryOver.approvedAt, approved.output.approvedAt);
  assert.equal(state.carryOver.approvedBy, approved.output.approvedBy);
  assert.equal(state.output.sha256, approved.output.sha256);
  assert.equal(state.output.approvedAt, null);
});

test('changed or ambiguous candidate matches cannot inherit a public exception or approval', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  await approve(old, await save(old, await initialize(old)));
  const changed = await build(f, 'changed', { candidatePrefix: 'new-' });
  changed.detections[0].candidates[1].category = 'amount';
  await assert.rejects(initializeLocalRedactions(changed), /REDACTION_CARRY_CANDIDATE_MISMATCH/);
  const ambiguous = await build(f, 'ambiguous', { candidatePrefix: 'new-' });
  ambiguous.detections[0].candidates.push({ ...ambiguous.detections[0].candidates[1], id: 'other-optional-name' });
  await assert.rejects(initializeLocalRedactions(ambiguous), /REDACTION_CARRY_CANDIDATE_MISMATCH/);
});

test('archiving an existing saved build preserves legacy edits and approval without another save', async t => {
  const f = await fixture(t), old = await build(f, 'legacy');
  const legacy = { ...old, carryStoreRoot: undefined };
  const approved = await approve(legacy, await save(legacy, await initialize(legacy)));
  const key = carryKey(old, f.png);
  assert.equal(await readRedactionCarry(key), null);
  await archiveSavedLocalRedactions({ root: old.root, buildId: old.buildId, carryStoreRoot: f.carryStoreRoot });
  assert.deepEqual((await readRedactionCarry(key)).state, approved);
  assert.deepEqual(await getLocalRedactionSlide(legacy), approved);
  const next = await build(f, 'next');
  const state = await initialize(next);
  assert.deepEqual(state.regions, approved.regions);
  assert.deepEqual(state.exceptions, approved.exceptions);
  assert.equal(state.carryOver.approvedAt, approved.output.approvedAt);
  assert.equal(state.carryOver.approvedBy, approved.output.approvedBy);
});

test('reinitializing an existing saved build seeds the carry store without changing its approval', async t => {
  const f = await fixture(t), old = await build(f, 'legacy');
  const legacy = { ...old, carryStoreRoot: undefined };
  const approved = await approve(legacy, await save(legacy, await initialize(legacy)));
  assert.equal(await readRedactionCarry(carryKey(old, f.png)), null);
  const [reused] = await initializeLocalRedactions(old);
  assert.deepEqual(reused, approved);
  const next = await build(f, 'next'), state = await initialize(next);
  assert.deepEqual(state.regions, approved.regions);
  assert.equal(state.carryOver.approvedAt, approved.output.approvedAt);
});

test('a different PNG hash carries no edits or approval even with the same original source', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  await approve(old, await save(old, await initialize(old)));
  const differentPng = await sharp(f.png).linear(.8).png().toBuffer();
  assert.notEqual(redactionHash(differentPng), redactionHash(f.png));
  const next = await build(f, 'different-png', { png: differentPng });
  const state = await initialize(next);
  assert.equal(state.carryOver, undefined);
  assert.equal(state.regions.some(region => !region.candidateId), false);
  assert.deepEqual(state.exceptions, []);
  assert.deepEqual(state.review, { reviewer: '', originalInspected: false, layoutAcceptable: true });
  assert.equal(state.output, null);
});

test('a different original fingerprint carries nothing even when the PNG bytes match', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  await approve(old, await save(old, await initialize(old)));
  const next = await build(f, 'different-source', { source: 'ANOTHER SYNTHETIC SOURCE' });
  const state = await initialize(next);
  assert.equal(state.imageHash, redactionHash(f.png));
  assert.equal(state.carryOver, undefined);
  assert.equal(state.regions.some(region => !region.candidateId), false);
  assert.deepEqual(state.exceptions, []);
  assert.equal(state.output, null);
});

test('the later save replaces the same source and PNG key without retaining an outdated approval', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  const approved = await approve(old, await save(old, await initialize(old)));
  const latest = await save(old, approved, 'later');
  const next = await build(f, 'next');
  const state = await initialize(next);
  assert.deepEqual(state.regions, latest.regions);
  assert.deepEqual(state.exceptions, latest.exceptions);
  assert.deepEqual(state.review, latest.review);
  assert.equal(state.carryOver.savedAt, latest.savedAt);
  assert.equal(state.carryOver.approvedAt, null);
  assert.equal(state.carryOver.approvedBy, null);
});

test('carried edits still enforce mandatory opaque regions on later saves', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  await save(old, await initialize(old));
  const next = await build(f, 'next'), state = await initialize(next);
  assert.ok(state.carryOver);
  await assert.rejects(saveLocalRedactionSlide({ ...next, expectedRevision: state.revision,
    regions: state.regions.map(region => ({ ...region, mode: 'blur' })), exceptions: state.exceptions, review: state.review }),
  /REQUIRED_REGION_MUST_BE_OPAQUE/);
});

test('a preparation artifact outside its work folder is rejected before carry-over is read', async t => {
  const f = await fixture(t), old = await build(f, 'old');
  await save(old, await initialize(old));
  const next = await build(f, 'next');
  const recordPath = path.join(next.root, 'builds', next.buildId, 'record.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  record.artifacts['highres:1'].relativePath = '../../../../../outside.png';
  await writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(initializeLocalRedactions(next), /path traversal|UNSAFE_PATH/i);
});

test('an older duplicate write cannot replace a newer record for the same carry key', async t => {
  const f = await fixture(t), identity = await build(f, 'work');
  const state = await save(identity, await initialize(identity));
  const key = carryKey(identity, f.png);
  const newer = { ...state, savedAt: '2030-01-02T00:00:00.000Z', review: { ...state.review, reviewer: 'later-writer' } };
  const older = { ...state, savedAt: '2030-01-01T00:00:00.000Z', review: { ...state.review, reviewer: 'older-writer' } };
  await writeRedactionCarry({ ...key, state: newer });
  await writeRedactionCarry({ ...key, state: older });
  const entry = await readRedactionCarry(key);
  assert.equal(entry.savedAt, newer.savedAt);
  assert.deepEqual(entry.state, newer);
});

test('carry paths reject work-folder storage, traversal and unsafe hash keys', async t => {
  const f = await fixture(t), identity = await build(f, 'work'), key = carryKey(identity, f.png);
  for (const root of [path.join(identity.root, 'WoolimWorker', 'redaction-carry'),
    `${identity.carryStoreRoot}${path.sep}..${path.sep}redaction-carry`, path.join(f.temporary, 'outside')]) {
    await assert.rejects(readRedactionCarry({ ...key, root }), /REDACTION_CARRY_UNSAFE_PATH/);
  }
  for (const invalid of [{ sourceHash: '../outside' },
    { sourceFingerprint: { ...key.sourceFingerprint, sha256: '../outside' } }]) {
    await assert.rejects(readRedactionCarry({ ...key, ...invalid }), /INVALID_REDACTION_CARRY_KEY/);
  }
});

test('a linked carry folder cannot read or write outside the private worker folder', async t => {
  const f = await fixture(t), identity = await build(f, 'work');
  const outside = path.join(f.temporary, 'outside');
  await mkdir(outside);
  await mkdir(path.dirname(f.carryStoreRoot), { recursive: true });
  try { await symlink(outside, f.carryStoreRoot, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`Directory links unavailable: ${error.code}`); return; }
    throw error;
  }
  const key = carryKey(identity, f.png);
  await assert.rejects(readRedactionCarry(key), /REDACTION_CARRY_UNSAFE_PATH/);
  const state = { sourceHash: key.sourceFingerprint.sha256, imageHash: key.sourceHash, savedAt: '2030-01-01T00:00:00.000Z' };
  await assert.rejects(writeRedactionCarry({ ...key, state }), /REDACTION_CARRY_UNSAFE_PATH/);
});
