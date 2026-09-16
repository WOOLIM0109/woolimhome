import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { padA4SourceSlide } from '../../portfolio/a4-source-fit.ts';
import { REDACTION_RULE_VERSION } from './redaction-types.ts';
import { assertFlatRedactionPng, decodeRedactionPng, OPAQUE_COLOR, pixelRedactionRect,
  redactionHash, redactionInputFingerprint, renderRedactedPng } from './redaction-renderer.ts';

// Entirely synthetic and memory-only: no customer files, work store, approval API,
// PowerPoint, environment loading or network transport participate in this test.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0); bytes.write(type, 4); data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
function chunkTypes(png) {
  const result = [];
  for (let offset = 8; offset < png.length; offset += png.readUInt32BE(offset) + 12) {
    result.push(png.toString('ascii', offset + 4, offset + 8));
  }
  return result;
}
function syntheticPowerPointLikePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const gamma = Buffer.alloc(4); gamma.writeUInt32BE(45455);
  const density = Buffer.alloc(9);
  density.writeUInt32BE(3780, 0); density.writeUInt32BE(3780, 4); density[8] = 1;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (1 + width * 4) + 1 + x * 4;
    rows[index] = x % 256; rows[index + 1] = y % 256;
    rows[index + 2] = (x * 7 + y * 3) % 256; rows[index + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('gAMA', gamma),
    chunk('pHYs', density), chunk('IDAT', deflateSync(rows)), chunk('IEND')]);
}

test('PowerPoint-like sRGB/gAMA/pHYs raw input is rejected by A4 fit but a flat redaction render passes without approval', async t => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_TEST'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const width = 780, height = 540;
  const source = syntheticPowerPointLikePng(width, height), originalHash = redactionHash(source);
  const fitInput = { sourceWidth: 780, sourceHeight: 540,
    aspectClass: 'a4_landscape', sourceKind: 'powerpoint_a4_preset' };
  assert.deepEqual(chunkTypes(source), ['IHDR', 'sRGB', 'gAMA', 'pHYs', 'IDAT', 'IEND']);
  await assert.rejects(padA4SourceSlide({ ...fitInput, buffer: source }),
    /A4_SOURCE_FIT_COLOR_METADATA_REQUIRES_RECONVERSION/);

  const rect = { x: .2, y: .3, width: .25, height: .15 };
  const state = {
    version: 1, ruleVersion: REDACTION_RULE_VERSION, workId: 'synthetic-work', buildId: 'synthetic-build',
    sourceSlideNumber: 1, sourceHash: redactionHash('SYNTHETIC PPT ONLY'),
    slideContentHash: redactionHash('SYNTHETIC SLIDE ONLY'), imageHash: originalHash,
    width, height, revision: 0,
    candidates: [{ id: 'synthetic-email', rect, category: 'email', required: true, reason: 'CONTACT_TEXT' }],
    warnings: [], regions: [{ id: 'synthetic-mask', candidateId: 'synthetic-email', rect, mode: 'opaque' }],
    exceptions: [], review: { reviewer: 'synthetic unit test', originalInspected: true, layoutAcceptable: true },
    status: 'editing', output: null,
  };
  const beforeState = structuredClone(state);
  await assert.rejects(renderRedactedPng(source, {
    ...state, review: { ...state.review, originalInspected: false },
  }), /ORIGINAL_REVIEW_REQUIRED/);
  const rendered = await renderRedactedPng(source, state);
  assert.doesNotThrow(() => assertFlatRedactionPng(rendered.png));
  assert.ok(chunkTypes(rendered.png).every(type => ['IHDR', 'IDAT', 'IEND', 'pHYs'].includes(type)));
  assert.equal(rendered.sha256, redactionHash(rendered.png));
  assert.notEqual(rendered.sha256, originalHash);
  assert.equal(rendered.inputFingerprint, redactionInputFingerprint(state));
  assert.deepEqual(rendered.checks, { outsidePreserved: true, requiredOpaque: true, metadataStripped: true });

  const original = await decodeRedactionPng(source), redacted = await decodeRedactionPng(rendered.png);
  const box = pixelRedactionRect(rect, width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = (y * width + x) * 4;
    const masked = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
    for (let channel = 0; channel < 4; channel++) {
      assert.equal(redacted.data[pixel + channel], masked ? OPAQUE_COLOR[channel] : original.data[pixel + channel]);
    }
  }

  const fitted = await padA4SourceSlide({ ...fitInput, buffer: rendered.png });
  const receipt = fitted.receipt;
  assert.equal(receipt.sourceHash, rendered.sha256);
  assert.notEqual(receipt.sourceHash, originalHash);
  assert.equal(receipt.resultHash, redactionHash(fitted.bytes));
  assert.equal(receipt.sourcePixelWidth, width); assert.equal(receipt.sourcePixelHeight, height);
  assert.equal(receipt.targetWidth, 780); assert.equal(receipt.targetHeight, 552);
  assert.deepEqual(receipt.padding, { top: 6, right: 0, bottom: 6, left: 0 });
  assert.equal(receipt.scale, 1); assert.equal(receipt.crop, false);
  const restored = await sharp(fitted.bytes).extract({ left: 0, top: 6, width, height }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(restored, redacted.data);
  for (const top of [0, 546]) {
    const padding = await sharp(fitted.bytes).extract({ left: 0, top, width, height: 6 }).ensureAlpha().raw().toBuffer();
    assert.ok(padding.every(value => value === 255));
  }
  assert.ok(chunkTypes(fitted.bytes).every(type => ['IHDR', 'IDAT', 'IEND'].includes(type)));
  assert.deepEqual(state, beforeState);
  assert.equal(state.output, null);
  assert.equal(state.status, 'editing');
  assert.equal('approvedAt' in rendered, false);
  assert.equal('approval' in receipt, false);
  assert.equal(redactionHash(source), originalHash);
});
