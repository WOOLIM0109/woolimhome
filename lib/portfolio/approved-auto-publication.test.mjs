import assert from 'node:assert/strict';
import test from 'node:test';
import { PORTFOLIO_RULE_VERSION, validatePortfolioPublicationMetadata } from '../content-ops/portfolio-rules.ts';
import { getRegisteredApprovedMockupSuite } from './approved-mockup-suites.ts';
import { resolveApprovedMockupSlots } from './approved-16x9-templates.ts';

// Publication rules stay frozen; exercise the new auto-render shapes from the
// portfolio test directory so no consulting/shared source or test file changes.
function metadataFor(aspectClass, mixed = false) {
  const suite = getRegisteredApprovedMockupSuite(aspectClass);
  const uniqueCount = mixed ? 30 : aspectClass === '16:9' ? 18 : 12;
  let next = 0;
  const capacities = mixed ? [6, 6, 6, 6, 6]
    : suite.bodyTemplates.map(template => resolveApprovedMockupSlots(template).length);
  const bodyAssets = capacities.map((capacity, index) => ({
    kind: 'body_image', url: `/body-${index}.jpg`,
    slideIndexes: Array.from({ length: capacity }, () => next++ % uniqueCount),
    mockupMode: mixed ? 'six_grid' : 'short_psd', aspectClass,
    ...(mixed ? {} : { mockupTemplateId: suite.bodyTemplates[index].id, mockupTemplateVersion: suite.version }),
  }));
  const indexes = Array.from({ length: uniqueCount }, (_, index) => index);
  const fingerprint = 'a'.repeat(64);
  return {
    portfolioSourceFingerprint: fingerprint,
    portfolioRuleVersion: PORTFOLIO_RULE_VERSION,
    portfolioGenerationId: 'approved-auto-render-generation',
    generated: { bodyHtml: bodyAssets.map((_, index) => `<p>장표 구성 ${index + 1} 설명입니다.</p><figure><img src="/body-${index}.jpg"><figcaption>설명</figcaption></figure>`).join('') },
    portfolioAssets: [{ kind: 'thumbnail', slideIndexes: [0], mockupMode: 'short_psd', aspectClass,
      mockupTemplateId: suite.thumbnail.id, mockupTemplateVersion: suite.version }, ...bodyAssets],
    portfolioMockup: { mode: 'short_psd', bodyBoardCount: bodyAssets.length, selectedSlideIndexes: indexes,
      redactionStatus: 'verified', aspectClass, templateSetId: suite.suiteId, templateVersion: suite.version },
    redactionProof: { version: 2, method: 'powerpoint_com_shapes_v2', verified: true,
      sourceFingerprint: fingerprint, manifestHash: 'b'.repeat(64),
      slides: indexes.map(slideIndex => ({ slideIndex, sourceHash: ((slideIndex % 8) + 1).toString(16).repeat(64),
        redactedHash: ((slideIndex % 8) + 8).toString(16).repeat(64), regionCount: 1, changedPixelRatio: 0.1 })) },
  };
}

for (const aspectClass of ['16:9', 'a4_portrait']) {
  test(`approved long ${aspectClass}: thumbnail and four bodies pass unchanged publication rules`, () => {
    const metadata = metadataFor(aspectClass);
    assert.equal(metadata.portfolioAssets.length, 5);
    assert.deepEqual(validatePortfolioPublicationMetadata(metadata), []);
  });
  test(`approved ${aspectClass} thumbnail mixed with five legacy bodies remains blocked`, () => {
    assert.ok(validatePortfolioPublicationMetadata(metadataFor(aspectClass, true))
      .some(issue => issue.includes('본문 목업 4장')));
  });
}
