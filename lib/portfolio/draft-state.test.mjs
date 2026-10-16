import assert from 'node:assert/strict';
import test from 'node:test';
import { portfolioDraftQueueState, portfolioDraftFailure } from './draft-state.ts';
import { generateGeminiText } from '../gemini/client.ts';
import { runWithGeminiInvocation } from '../gemini/protection.ts';

test('enabled mockups queue drafts; disabled mockups retain the actual reason', () => {
  assert.equal(portfolioDraftQueueState({ enabled: true, reason: null }).status, 'queued');
  const disabled = portfolioDraftQueueState({ enabled: false, reason: 'API key missing' });
  assert.equal(disabled.status, 'draft_waiting');
  assert.equal(disabled.error_message, 'API key missing');
});
test('budget and provider errors stop automatic retries without losing their reason', () => {
  for (const code of ['GEMINI_DISABLED', 'GEMINI_BUDGET_EXCEEDED', 'GEMINI_RATE_LIMIT']) {
    assert.deepEqual(portfolioDraftFailure({ code, message: code + ' detail' }), {
      status: 'draft_waiting', next_retry_at: null, last_error_code: code, error_message: code + ' detail',
    });
  }
});
test('Gemini transport is stubbed and a quota error never loops', async () => {
  const oldFetch = globalThis.fetch;
  const keys = ['GEMINI_ENABLED', 'GEMINI_ALLOW_NON_PRODUCTION', 'GEMINI_API_KEY'];
  const previous = keys.map(key => process.env[key]);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }); };
  try {
    process.env.GEMINI_ENABLED = 'true'; process.env.GEMINI_ALLOW_NON_PRODUCTION = 'true'; process.env.GEMINI_API_KEY = 'test-only';
    await assert.rejects(runWithGeminiInvocation({ operationId: 'test', actor: 'test', project: 'test', model: 'gemini-3.5-flash', promptVersion: 'test', contentHash: 'test', contentCount: 1 },
      () => generateGeminiText({ parts: [{ text: 'synthetic' }], attempts: 1 })));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
