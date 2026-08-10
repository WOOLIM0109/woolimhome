import assert from "node:assert/strict";
import test from "node:test";
import { GeminiRequestError, geminiRetryDecision } from "./retry.ts";

test("rate limits are never requeued in the background", () => {
  const error = new GeminiRequestError({ code: "GEMINI_RATE_LIMIT", message: "limited", retryable: true });
  const first = geminiRetryDecision(error, 0);
  assert.equal(first.retryable, false);
  assert.equal(first.nextRetryAt, null);
});

test("quota errors also require an explicit user retry", () => {
  const error = new GeminiRequestError({ code: "GEMINI_QUOTA_EXHAUSTED", message: "quota", retryable: true });
  assert.equal(geminiRetryDecision(error, 0).retryable, false);
  assert.equal(geminiRetryDecision(error, 0).nextRetryAt, null);
});
