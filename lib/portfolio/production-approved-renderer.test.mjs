import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import { renderProductionApprovedMockup } from './production-approved-renderer.ts';
import { renderApprovedMockup } from './approved-16x9-renderer.ts';
import { APPROVED_MOCKUP_SUITES } from './approved-mockup-suites.ts';
import { resolveApprovedMockupSlots } from './approved-16x9-templates.ts';
import { APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES } from './approved-mockup-runtime.ts';

const sha = b => createHash('sha256').update(b).digest('hex');
test('server subprocess exactly matches unchanged approved renderer pixels and slot geometry for three suites', async () => {
  const fingerprints = await Promise.all(APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES.map(async file => sha(await readFile(file))));
  for (const suite of APPROVED_MOCKUP_SUITES) {
    for (const template of [suite.thumbnail, suite.bodyTemplates.at(-1)]) {
      const slides = await Promise.all(resolveApprovedMockupSlots(template).map(async (_, index) => ({ index,
        buffer: await sharp({ create: { width: 360, height: Math.round(360 / template.slideAspectRatio), channels: 3,
          background: { r: 30 + index * 20, g: 80, b: 130 } } }).png().toBuffer() })));
      const input = { template, slides, title: '합성 이미지 검수', scale: 0.5, outputFormat: 'png' };
      const expected = await renderApprovedMockup(input), actual = await renderProductionApprovedMockup(input);
      assert.deepEqual(actual, expected, template.id);
    }
  }
  assert.deepEqual(await Promise.all(APPROVED_MOCKUP_RUNTIME_IMPLEMENTATION_FILES.map(async file => sha(await readFile(file)))), fingerprints);
});
test('server wrapper rejects custom coordinates, paths and oversized/untrusted inputs', async () => {
  const template = APPROVED_MOCKUP_SUITES[0].thumbnail;
  const slides = [{ index: 0, buffer: Buffer.from('mock') }];
  for (const input of [{ template: { ...template, canvas: { width: 1, height: 1 } }, slides },
    { template, slides, runtimeRoot: 'C:/arbitrary' }, { template, slides: [{ index: -1, buffer: Buffer.from('x') }] },
    { template, slides, title: 'x'.repeat(1001) }]) {
    await assert.rejects(renderProductionApprovedMockup(input), /APPROVED_SERVER_RENDER_INPUT_INVALID/);
  }
});
test('Next server imports use subprocess boundary while approved files are traced as unbundled sources', async () => {
  for (const file of ['lib/portfolio/mockup.ts', 'lib/portfolio/short-mockup.ts']) {
    const text = await readFile(file, 'utf8');
    assert.match(text, /production-approved-renderer/); assert.doesNotMatch(text, /from ["']\.\/approved-16x9-renderer/);
  }
  const config = await readFile('next.config.ts', 'utf8');
  for (const file of ['scripts/render-production-approved-mockup.mjs','lib/portfolio/approved-mockup-runtime.ts','public/images/woolim-logo-cropped.png',
    'public/images/mockup-templates/a4-portrait-dark-wood.png','public/fonts/Paperlogy-7Bold.ttf','scripts/render-production-thumbnail.mjs']) assert.ok(config.includes(file));
  const child = await readFile('scripts/render-production-approved-mockup.mjs', 'utf8');
  assert.match(child, /APPROVED_SERVER_NETWORK_FORBIDDEN/);
});
