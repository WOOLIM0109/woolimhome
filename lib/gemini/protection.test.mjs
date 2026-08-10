import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGeminiInvocationAllowed,
  budgetDecision,
  buildGeminiReviewPrompt,
  estimateGeminiInputTokens,
  geminiRuntimeStatus,
  geminiReviewProviderPayload,
  normalizeGeminiReviewItems,
  remapGeminiReviewResultsToClientIds,
  reviewCacheKey,
  reviewContentHash,
  runWithGeminiInvocation,
} from "./protection.ts";
import { generateGeminiText } from "./client.ts";

function withEnvironment(values, work) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(work()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("only changed content is normalized and sent", () => {
  const items = normalizeGeminiReviewItems([
    { id: "same", title: "same", originalContent: "unchanged", changedContent: "unchanged", context: "" },
    { id: "changed", title: "title", originalContent: "PRIVATE ORIGINAL", changedContent: "edited", context: "nearby heading" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].clientId, "changed");
  const prompt = buildGeminiReviewPrompt(items);
  assert.equal(prompt.includes("PRIVATE ORIGINAL"), false);
  assert.equal(prompt.includes("edited"), true);
  assert.equal(prompt.includes("nearby heading"), true);
  assert.equal(prompt.includes('"clientId"'), false);
});

test("two distant edits omit the unchanged middle manuscript", () => {
  const privateMiddle = "DO_NOT_SEND_MIDDLE_".repeat(20);
  const items = normalizeGeminiReviewItems([{
    id: "client-row",
    title: "two edits",
    originalContent: `도입 원문입니다. 첫 문장은 이전 표현입니다. ${privateMiddle} 마지막 문장은 이전 표현입니다. 맺음말입니다.`,
    changedContent: `도입 원문입니다. 첫 문장은 짧은 표현입니다. ${privateMiddle} 마지막 문장은 명확한 표현입니다. 맺음말입니다.`,
    context: "",
  }]);
  const prompt = buildGeminiReviewPrompt(items);
  assert.equal(prompt.includes('"changedText":"짧은"'), true);
  assert.equal(prompt.includes('"changedText":"명확한"'), true);
  assert.equal(prompt.includes(privateMiddle), false);
  assert.equal(prompt.includes("DO_NOT_SEND_MIDDLE_DO_NOT_SEND_MIDDLE_DO_NOT_SEND_MIDDLE"), false);
  assert.equal(items[0].changes.length, 2);
});

test("a tiny edit inside a long unbroken token never becomes a full-body hunk", () => {
  const privateLeft = "PRIVATE_LEFT_".repeat(1_000);
  const privateRight = "PRIVATE_RIGHT_".repeat(1_000);
  const items = normalizeGeminiReviewItems([{
    id: "long-token",
    title: "",
    originalContent: `${privateLeft}OLD${privateRight}`,
    changedContent: `${privateLeft}NEW${privateRight}`,
    context: "",
  }]);
  assert.equal(items[0].changes.length, 1);
  assert.equal(items[0].changes[0].changedText, "NEW");
  assert.ok(items[0].changes[0].contextBefore.length <= 48);
  assert.ok(items[0].changes[0].contextAfter.length <= 48);
  const prompt = buildGeminiReviewPrompt(items);
  assert.equal(prompt.includes("PRIVATE_LEFT_".repeat(20)), false);
  assert.equal(prompt.includes("PRIVATE_RIGHT_".repeat(20)), false);
});

test("provider payload, hash and ids ignore transient client ids and input order", () => {
  const firstInput = [
    { id: "temporary-100", title: "B", originalContent: "old B", changedContent: "new B", context: "ctx B" },
    { id: "temporary-200", title: "A", originalContent: "old A", changedContent: "new A", context: "ctx A" },
  ];
  const secondInput = [
    { ...firstInput[1], id: "different-client-a" },
    { ...firstInput[0], id: "different-client-b" },
  ];
  const first = normalizeGeminiReviewItems(firstInput);
  const second = normalizeGeminiReviewItems(secondInput);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id),
  );
  assert.deepEqual(geminiReviewProviderPayload(first), geminiReviewProviderPayload(second));
  assert.equal(reviewContentHash(first), reviewContentHash(second));
  assert.equal(buildGeminiReviewPrompt(first), buildGeminiReviewPrompt(second));

  const remapped = remapGeminiReviewResultsToClientIds(first, [{
    id: first[0].id,
    status: "passed",
  }]);
  assert.equal(remapped[0].id, first[0].clientId);
  assert.equal(remapped[0].providerId, first[0].id);
});

test("identical provider content is rejected before duplicate content can be sent", () => {
  assert.throws(() => normalizeGeminiReviewItems([
    { id: "client-one", title: "same", originalContent: "old", changedContent: "new", context: "" },
    { id: "client-two", title: "same", originalContent: "old", changedContent: "new", context: "" },
  ]), /동일한 변경 콘텐츠/);
});

test("privacy redaction happens before provider ids, prompts and hashes are built", () => {
  const first = normalizeGeminiReviewItems([{
    id: "client-one",
    title: "담당자: 김민수",
    originalContent: "연락처 010-1111-2222. 이전 문장.",
    changedContent: "연락처 010-1111-2222. 수정 문장.",
    context: "메일 first@example.com",
  }]);
  const second = normalizeGeminiReviewItems([{
    id: "client-two",
    title: "담당자: 박영희",
    originalContent: "연락처 010-9999-8888. 이전 문장.",
    changedContent: "연락처 010-9999-8888. 수정 문장.",
    context: "메일 second@example.com",
  }]);
  const prompt = buildGeminiReviewPrompt(first);
  assert.equal(prompt.includes("김민수"), false);
  assert.equal(prompt.includes("010-1111-2222"), false);
  assert.equal(prompt.includes("first@example.com"), false);
  assert.equal(prompt.includes("[NAME]"), true);
  assert.equal(prompt.includes("[PHONE]"), true);
  assert.equal(prompt.includes("[EMAIL]"), true);
  assert.equal(first[0].id, second[0].id);
  assert.equal(reviewContentHash(first), reviewContentHash(second));
});

test("oversized item counts and fields are rejected instead of truncated", () => {
  const item = { id: "id", title: "", originalContent: "old", changedContent: "new", context: "" };
  assert.throws(
    () => normalizeGeminiReviewItems(Array.from({ length: 21 }, (_, index) => ({ ...item, id: `id-${index}` }))),
    /20건/,
  );
  assert.throws(
    () => normalizeGeminiReviewItems([{ ...item, changedContent: "x".repeat(30_001) }]),
    /30,000자/,
  );
  assert.throws(
    () => normalizeGeminiReviewItems([{ ...item, context: "x".repeat(1_501) }]),
    /1,500자/,
  );
  assert.throws(
    () => normalizeGeminiReviewItems([
      { ...item, id: "first" },
      { ...item, id: "second" },
    ]),
    /중복/,
  );
});

test("a diff that exceeds the safe complexity limit is rejected instead of sending a coarse full manuscript", () => {
  const originalContent = Array.from({ length: 600 }, (_, index) => `old-${index}`).join(" ");
  const changedContent = Array.from({ length: 600 }, (_, index) => `new-${index}`).join(" ");
  assert.throws(
    () => normalizeGeminiReviewItems([{
      id: "large-rewrite",
      title: "",
      originalContent,
      changedContent,
      context: "",
    }]),
    /여러 검수 항목으로 나누어/,
  );
});

test("cache identity includes content hash, prompt version and model", () => {
  const items = normalizeGeminiReviewItems([
    { id: "1", originalContent: "a", changedContent: "b", title: "", context: "" },
  ]);
  const contentHash = reviewContentHash(items);
  assert.notEqual(
    reviewCacheKey(contentHash, "v1", "model-a"),
    reviewCacheKey(contentHash, "v1", "model-b"),
  );
  assert.notEqual(
    reviewCacheKey(contentHash, "v1", "model-a"),
    reviewCacheKey(contentHash, "v2", "model-a"),
  );
});

test("input token reservation uses a provider-free UTF-8 byte upper bound", () => {
  assert.equal(estimateGeminiInputTokens("abc"), 3);
  assert.equal(estimateGeminiInputTokens("가"), 3);
  assert.equal(estimateGeminiInputTokens("😀"), 4);
  const highEntropyAscii = "aZ09-_?/".repeat(2_000);
  assert.equal(
    estimateGeminiInputTokens(highEntropyAscii),
    Buffer.byteLength(highEntropyAscii, "utf8"),
  );
});

test("high-risk document markers and unredacted secrets fail closed", () => {
  const base = { id: "sensitive", title: "", originalContent: "old", context: "" };
  assert.throws(() => normalizeGeminiReviewItems([{
    ...base,
    changedContent: "대외비 문서의 변경 내용",
  }]), /AI 전송을 차단/);
  assert.throws(() => normalizeGeminiReviewItems([{
    ...base,
    changedContent: "API key: still-secret-value",
  }]), /AI 전송을 차단/);
});

test("raw high-risk markers cannot be hidden by configured redaction terms", async () => {
  await withEnvironment({
    PII_REDACTION_TERMS: "대외비,password,외부 공유 금지",
  }, async () => {
    const base = {
      id: "raw-sensitive",
      title: "공개 원고",
      originalContent: "이전 문장",
      changedContent: "수정 문장",
      context: "",
    };
    for (const item of [
      { ...base, title: "대외비 제안서" },
      { ...base, originalContent: "password: original-secret" },
      { ...base, changedContent: "password: changed-secret" },
      { ...base, context: "외부 공유 금지" },
    ]) {
      assert.throws(() => normalizeGeminiReviewItems([item]), /AI 전송을 차단/);
    }
  });
});

test("runtime activation requires configured privacy terms", async () => {
  await withEnvironment({
    GEMINI_ENABLED: "true",
    GEMINI_API_KEY: "stub-only",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    PII_REDACTION_TERMS: "",
  }, async () => {
    const status = geminiRuntimeStatus();
    assert.equal(status.enabled, false);
    assert.match(status.reason, /PII_REDACTION_TERMS/);
  });
  await withEnvironment({
    GEMINI_ENABLED: "true",
    GEMINI_API_KEY: "stub-only",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    PII_REDACTION_TERMS: "테스트고객",
  }, async () => {
    assert.equal(geminiRuntimeStatus().enabled, true);
  });
});

test("daily and monthly limits block before a provider call", () => {
  const config = {
    dailyCalls: 1,
    monthlyCalls: 2,
    dailyCostUsd: 1,
    monthlyCostUsd: 2,
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 1,
  };
  assert.equal(budgetDecision({
    dailyCallsUsed: 1,
    monthlyCallsUsed: 1,
    dailyCostUsed: 0,
    monthlyCostUsed: 0,
  }, 0.1, config).allowed, false);
  assert.equal(budgetDecision({
    dailyCallsUsed: 0,
    monthlyCallsUsed: 1,
    dailyCostUsed: 0.95,
    monthlyCostUsed: 1,
  }, 0.1, config).allowed, false);
  assert.equal(budgetDecision({
    dailyCallsUsed: 0,
    monthlyCallsUsed: 0,
    dailyCostUsed: 0,
    monthlyCostUsed: 0,
  }, 0.1, config, 2).allowed, false);
});

test("disabled or unconfirmed execution cannot reach a mocked transport", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("mock transport must remain untouched");
  };
  try {
    await withEnvironment({ GEMINI_ENABLED: "false", NODE_ENV: "production" }, async () => {
      assert.throws(() => assertGeminiInvocationAllowed("model"));
    });
    await withEnvironment({
      GEMINI_ENABLED: "true",
      GEMINI_API_KEY: "stub-only",
      NODE_ENV: "production",
      PII_REDACTION_TERMS: "테스트고객",
    }, async () => {
      assert.throws(() => assertGeminiInvocationAllowed("model"));
      await runWithGeminiInvocation({
        operationId: "operation",
        actor: "admin@example.com",
        project: "test",
        model: "model",
        promptVersion: "v1",
        contentHash: "hash",
        contentCount: 1,
      }, async () => {
        assert.equal(assertGeminiInvocationAllowed("model").operationId, "operation");
      });
    });
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mocked 429 is retried once, while non-5xx failures are not retried", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const success = () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "{\"results\":[]}" }] } }],
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 4,
      totalTokenCount: 16,
      cachedContentTokenCount: 0,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    await withEnvironment({
      GEMINI_ENABLED: "true",
      GEMINI_API_KEY: "stub-only",
      NODE_ENV: "production",
      PII_REDACTION_TERMS: "테스트고객",
    }, async () => {
      const context = {
        operationId: "operation",
        actor: "admin@example.com",
        project: "test",
        model: "model",
        promptVersion: "v1",
        contentHash: "hash",
        contentCount: 1,
      };
      globalThis.fetch = async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { "retry-after": "0" } })
          : success();
      };
      const response = await runWithGeminiInvocation(context, () => generateGeminiText({
        model: "model",
        parts: [{ text: "stub" }],
        attempts: 2,
      }));
      assert.equal(fetchCount, 2);
      assert.equal(response.networkAttempts, 2);
      assert.deepEqual(response.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        outcome: attempt.outcome,
        httpStatus: attempt.httpStatus,
      })), [
        { attempt: 1, outcome: "failed", httpStatus: 429 },
        { attempt: 2, outcome: "completed", httpStatus: 200 },
      ]);
      assert.deepEqual(response.usage, {
        inputTokens: 12,
        outputTokens: 4,
        candidateTokens: 4,
        thoughtsTokens: 0,
        totalTokens: 16,
        cachedInputTokens: 0,
      });

      fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount += 1;
        return new Response('{"error":{"message":"bad request"}}', { status: 400 });
      };
      await assert.rejects(() => runWithGeminiInvocation(context, () => generateGeminiText({
        model: "model",
        parts: [{ text: "stub" }],
        attempts: 2,
      })));
      assert.equal(fetchCount, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
