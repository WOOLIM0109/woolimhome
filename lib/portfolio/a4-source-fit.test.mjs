import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { padA4SourceSlide } from './a4-source-fit.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let crc = i; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); return crc >>> 0;
});
function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length, 0); bytes.write(type, 4); data.copy(bytes, 8);
  let crc = 0xffffffff; for (const byte of bytes.subarray(4, -4)) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
}
const addChunk = (png, type, data) => Buffer.concat([png.subarray(0, 33), chunk(type, data), png.subarray(33)]);
async function source(width, height, alpha = 255) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = x % 256; pixels[i + 1] = y % 256; pixels[i + 2] = (x * 7 + y * 3) % 256; pixels[i + 3] = alpha;
  }
  return { pixels, buffer: await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer() };
}
const preset = (buffer, portrait = false) => ({ buffer, sourceWidth: portrait ? 540 : 780, sourceHeight: portrait ? 780 : 540,
  aspectClass: portrait ? 'a4_portrait' : 'a4_landscape', sourceKind: 'powerpoint_a4_preset' });
const preview = (buffer, width, height) => ({ buffer, sourceWidth: width, sourceHeight: height,
  aspectClass: width > height ? 'a4_landscape' : 'a4_portrait', sourceKind: 'custom_preview' });
async function assertPixels(result, original) {
  const r = result.receipt, { data, info } = await sharp(result.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, r.targetWidth); assert.equal(info.height, r.targetHeight);
  const extracted = await sharp(result.bytes).extract({ left: r.padding.left, top: r.padding.top,
    width: r.sourcePixelWidth, height: r.sourcePixelHeight }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(extracted, original);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (x >= r.padding.left && x < r.padding.left + r.sourcePixelWidth
      && y >= r.padding.top && y < r.padding.top + r.sourcePixelHeight) continue;
    assert.deepEqual(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4), Buffer.from([255,255,255,255]));
  }
  assert.ok(r.targetWidth === r.sourcePixelWidth || r.targetHeight === r.sourcePixelHeight);
  assert.equal(r.scale, 1); assert.equal(r.crop, false); assert.equal(r.resultHash, hash(result.bytes));
  assert.ok(Math.abs(r.padding.left - r.padding.right) <= 1); assert.ok(Math.abs(r.padding.top - r.padding.bottom) <= 1);
  assert.equal('approval' in r, false);
}

test('A4 source padding is memory-only, pixel-exact, centered and never an approval', async t => {
  const previousFetch = globalThis.fetch; globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  await t.test('both PowerPoint presets preserve every original pixel and map coordinates by translation only', async () => {
    for (const portrait of [false, true]) {
      const s = await source(portrait ? 540 : 780, portrait ? 780 : 540), args = preset(s.buffer, portrait);
      const result = await padA4SourceSlide(args);
      assert.equal(result.receipt.version, 1); assert.equal(result.receipt.sourceHash, hash(s.buffer));
      assert.equal(result.receipt.sourceWidth, args.sourceWidth); assert.equal(result.receipt.sourceHeight, args.sourceHeight);
      assert.equal(result.receipt.targetWidth, portrait ? 552 : 780); assert.equal(result.receipt.targetHeight, portrait ? 780 : 552);
      assert.deepEqual(result.receipt.padding, portrait ? { top: 0, right: 6, bottom: 0, left: 6 } : { top: 6, right: 0, bottom: 6, left: 0 });
      await assertPixels(result, s.pixels);
    }
  });
  await t.test('one-pixel raster rounding and odd padding remain centered without resampling', async () => {
    const s = await source(780, 539), result = await padA4SourceSlide(preset(s.buffer));
    assert.deepEqual(result.receipt.padding, { top: 6, right: 0, bottom: 7, left: 0 });
    await assertPixels(result, s.pixels);
    await padA4SourceSlide({ ...preset(s.buffer), sourceWidth: 780 + 0.000009, sourceHeight: 540 - 0.000009 });
  });
  await t.test('custom preview requires explicit kind and supports extending the other axis in both orientations', async () => {
    for (const [width, height] of [[140,100], [100,140]]) {
      const s = await source(width, height), result = await padA4SourceSlide(preview(s.buffer, width * 10, height * 10));
      assert.equal(result.receipt.sourceKind, 'custom_preview');
      assert.equal(result.receipt.targetWidth, width > height ? 142 : 100);
      assert.equal(result.receipt.targetHeight, width > height ? 100 : 142);
      await assertPixels(result, s.pixels);
      await assert.rejects(padA4SourceSlide({ ...preview(s.buffer, width, height), sourceKind: undefined }), /EXPLICIT_SOURCE_KIND_REQUIRED/);
    }
  });
  await t.test('only non-transforming metadata is stripped, without source sample changes', async () => {
    const s = await source(780, 540);
    const buffer = addChunk(addChunk(s.buffer, 'tEXt', Buffer.from('Comment\0SYNTHETIC PRIVATE METADATA')), 'sRGB', Buffer.from([0]));
    const result = await padA4SourceSlide(preset(buffer)), chunks = [];
    for (let offset = 8; offset < result.bytes.length;) {
      chunks.push(result.bytes.toString('ascii', offset + 4, offset + 8)); offset += result.bytes.readUInt32BE(offset) + 12;
    }
    assert.ok(chunks.every(type => ['IHDR','IDAT','IEND'].includes(type))); assert.ok(!result.bytes.includes(Buffer.from('SYNTHETIC PRIVATE')));
    await assertPixels(result, s.pixels);
  });
  await t.test('orientation, ICC, gamma, chromaticity and HDR metadata require reconversion, never silent stripping', async () => {
    const s = await source(780, 540);
    const exif = await sharp(s.buffer).withExif({ IFD0: { Orientation: '6' } }).png().toBuffer();
    await assert.rejects(padA4SourceSlide(preset(exif)), /ORIENTATION_METADATA_REQUIRES_RECONVERSION/);
    const profile = await sharp(s.buffer).withIccProfile('p3').png().toBuffer();
    await assert.rejects(padA4SourceSlide(preset(profile)), /COLOR_METADATA_REQUIRES_RECONVERSION/);
    for (const type of ['gAMA', 'cHRM', 'cICP', 'mDCV', 'cLLI']) {
      await assert.rejects(padA4SourceSlide(preset(addChunk(s.buffer, type, Buffer.alloc(32)))), /COLOR_METADATA_REQUIRES_RECONVERSION/);
    }
    await assert.rejects(padA4SourceSlide(preset(addChunk(s.buffer, 'sRGB', Buffer.from([4])))), /INVALID_SRGB_DECLARATION/);
  });
  await t.test('invalid point sizes, wrong orientation, arbitrary ratios and mismatched raster sources fail closed', async () => {
    const s = await source(780, 540), args = preset(s.buffer);
    for (const value of [0, -1, NaN, Infinity, 14401]) await assert.rejects(padA4SourceSlide({ ...args, sourceWidth: value }), /INVALID_POINT_SIZE/);
    for (const delta of [0.001, 1, -1]) await assert.rejects(padA4SourceSlide({ ...args, sourceWidth: 780 + delta }), /PPT_A4_PRESET_REQUIRED/);
    await assert.rejects(padA4SourceSlide({ ...args, sourceWidth: 390, sourceHeight: 270 }), /PPT_A4_PRESET_REQUIRED/);
    await assert.rejects(padA4SourceSlide({ ...args, aspectClass: 'a4_portrait' }), /WRONG_ORIENTATION/);
    await assert.rejects(padA4SourceSlide({ ...args, aspectClass: '16:9' }), /INVALID_ASPECT_CLASS/);
    await assert.rejects(padA4SourceSlide(preview(s.buffer, 1600, 900)), /CUSTOM_RATIO_OUTSIDE_PREVIEW_LIMIT/);
    await assert.rejects(padA4SourceSlide(preview(s.buffer, 1400, 1000)), /SOURCE_PIXEL_RATIO_MISMATCH/);
    const wrong = await source(540, 780); await assert.rejects(padA4SourceSlide(preset(wrong.buffer)), /WRONG_ORIENTATION/);
    const stretched = await source(780, 537); await assert.rejects(padA4SourceSlide(preset(stretched.buffer)), /SOURCE_PIXEL_RATIO_MISMATCH/);
  });
  await t.test('only bounded opaque single-frame 8-bit PNGs are accepted', async () => {
    const s = await source(780, 540), args = preset(s.buffer);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: Buffer.alloc(12 * 1024 * 1024 + 1) }), /INPUT_SIZE_OR_TYPE/);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: 'not a buffer' }), /INPUT_SIZE_OR_TYPE/);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: await sharp(s.buffer).jpeg().toBuffer() }), /PNG_REQUIRED/);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: Buffer.concat([s.buffer, Buffer.from('trailing')]) }), /INVALID_PNG/);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: s.buffer.subarray(0, -2) }), /INVALID_PNG/);
    const wide = Buffer.from(s.buffer); wide.writeUInt32BE(4097, 16);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: wide }), /PIXEL_SIZE_LIMIT/);
    const deep = Buffer.from(s.buffer); deep[24] = 16;
    await assert.rejects(padA4SourceSlide({ ...args, buffer: deep }), /EIGHT_BIT_PNG_REQUIRED/);
    const apngChunk = Buffer.alloc(20); apngChunk.writeUInt32BE(8, 0); apngChunk.write('acTL', 4);
    await assert.rejects(padA4SourceSlide({ ...args, buffer: Buffer.concat([s.buffer.subarray(0, 33), apngChunk, s.buffer.subarray(33)]) }), /SINGLE_FRAME_REQUIRED/);
    const transparent = await source(780, 540, 128); await assert.rejects(padA4SourceSlide(preset(transparent.buffer)), /OPAQUE_SOURCE_REQUIRED/);
  });
  await t.test('padding itself cannot exceed the long-edge bound', async () => {
    const buffer = await sharp({ create: { width: 4096, height: 2897, channels: 4, background: '#fff' } }).png().toBuffer();
    await assert.rejects(padA4SourceSlide(preview(buffer, 4096, 2897)), /TARGET_PIXEL_SIZE_LIMIT/);
  });
  await t.test('an input below 12 MiB cannot return an expanded RGBA output above 12 MiB', async () => {
    const width = 3500, height = 2423, header = Buffer.alloc(13), palette = Buffer.alloc(256 * 3);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 3;
    let state = 0x47ab139f;
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; };
    for (let i = 0; i < palette.length; i++) palette[i] = next();
    const rows = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 1; x <= width; x++) rows[y * (width + 1) + x] = next();
    const buffer = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
      chunk('PLTE', palette), chunk('IDAT', deflateSync(rows)), chunk('IEND')]);
    assert.ok(buffer.length < 12 * 1024 * 1024);
    await assert.rejects(padA4SourceSlide(preset(buffer)), /OUTPUT_SIZE_LIMIT/);
  });
});
