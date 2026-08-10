import { generateGeminiText, GeminiRequestError } from "./client";
import {
  budgetDecision,
  buildGeminiReviewPrompt,
  estimatedGeminiCostUsd,
  estimateGeminiInputTokens,
  GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
  GEMINI_REVIEW_MAX_OUTPUT_TOKENS,
  GEMINI_REVIEW_MODEL,
  GEMINI_REVIEW_PROMPT_VERSION,
  geminiBudgetConfig,
  geminiRuntimeStatus,
  normalizeGeminiReviewItems,
  remapGeminiReviewResultsToClientIds,
  reviewCacheKey,
  reviewContentHash,
  runWithGeminiInvocation,
  type GeminiReviewItem,
} from "./protection";
import {
  claimGeminiGlobalLock,
  consumeGeminiApproval,
  createGeminiApproval,
  findGeminiReviewProgress,
  finishGeminiUsageLog,
  geminiUsageSnapshot,
  logGeminiCacheHit,
  publicBudgetSnapshot,
  releaseGeminiGlobalLock,
  startGeminiUsageLog,
  writeGeminiReviewCaches,
} from "./review-store";
import {
  mergeGeminiReviewResults,
  pendingGeminiProviderIds,
  type StoredGeminiReviewResult,
  type StoredGeminiReviewRow,
} from "./cache-policy";

type ReviewResult = StoredGeminiReviewRow;
type StoredReviewResult = StoredGeminiReviewResult;

function clientReviewResult(stored: StoredReviewResult, items: GeminiReviewItem[]) {
  const results = remapGeminiReviewResultsToClientIds(items, stored.results);
  return {
    results,
    failedItemIds: results.filter((item) => item.status === "failed").map((item) => item.id),
  };
}

function stripFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function parseReviewResult(text: string, items: GeminiReviewItem[]): StoredReviewResult {
  const parsed = JSON.parse(stripFence(text)) as { results?: unknown };
  const rows = Array.isArray(parsed.results) ? parsed.results : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    if (id && !byId.has(id)) byId.set(id, row);
  }
  const results = items.map((item): ReviewResult => {
    const row = byId.get(item.id);
    const rawStatus = row?.status;
    const status = rawStatus === "passed" || rawStatus === "needs_revision" || rawStatus === "failed"
      ? rawStatus
      : "failed";
    return {
      id: item.id,
      status,
      issues: Array.isArray(row?.issues) ? row.issues.map(String).filter(Boolean).slice(0, 12) : [],
      suggestedContent: typeof row?.suggestedContent === "string"
        ? row.suggestedContent.slice(0, 30_000)
        : "",
    };
  });
  return {
    results,
    failedItemIds: results.filter((item) => item.status === "failed").map((item) => item.id),
  };
}

function reviewIdentityForItems(items: GeminiReviewItem[]) {
  const prompt = items.length > 0 ? buildGeminiReviewPrompt(items) : "";
  const contentHash = reviewContentHash(items);
  const promptVersion = GEMINI_REVIEW_PROMPT_VERSION;
  const model = GEMINI_REVIEW_MODEL;
  const cacheKey = reviewCacheKey(contentHash, promptVersion, model);
  const estimatedInputTokens = prompt ? estimateGeminiInputTokens(prompt) : 0;
  const estimatedMaxCostUsd = prompt
    ? estimatedGeminiCostUsd(
      estimatedInputTokens,
      GEMINI_REVIEW_MAX_OUTPUT_TOKENS,
    ) * GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS
    : 0;
  return {
    items,
    prompt,
    contentHash,
    promptVersion,
    model,
    cacheKey,
    estimatedInputTokens,
    estimatedMaxCostUsd,
    inputChars: prompt.length,
  };
}

function reviewIdentity(rawItems: unknown) {
  const items = normalizeGeminiReviewItems(rawItems);
  if (!items.length) throw new Error("변경된 콘텐츠가 없습니다.");
  return reviewIdentityForItems(items);
}

function providerCacheKeys(identity: ReturnType<typeof reviewIdentityForItems>) {
  return Object.fromEntries(identity.items.map((item) => [
    item.id,
    reviewCacheKey(item.id, identity.promptVersion, identity.model),
  ]));
}

async function reviewProgress(identity: ReturnType<typeof reviewIdentity>) {
  const recovered = await findGeminiReviewProgress({
    batchCacheKey: identity.cacheKey,
    providerCacheKeys: providerCacheKeys(identity),
    promptVersion: identity.promptVersion,
    model: identity.model,
  });
  const providerIds = identity.items.map((item) => item.id);
  const pendingIds = new Set(pendingGeminiProviderIds(providerIds, recovered.providerResults));
  const pendingItems = identity.items.filter((item) => pendingIds.has(item.id));
  return {
    ...recovered,
    pendingIdentity: reviewIdentityForItems(pendingItems),
    mergedResult: mergeGeminiReviewResults(providerIds, recovered.providerResults),
  };
}

export async function prepareGeminiReview(rawItems: unknown, actor: string) {
  const identity = reviewIdentity(rawItems);
  const [progress, usage] = await Promise.all([
    reviewProgress(identity),
    geminiUsageSnapshot(),
  ]);
  const requestIdentity = progress.pendingIdentity;
  const runtime = geminiRuntimeStatus();
  const budget = budgetDecision(
    usage,
    requestIdentity.estimatedMaxCostUsd,
    undefined,
    GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
  );
  const cacheHit = requestIdentity.items.length === 0;
  const enabled = cacheHit || (runtime.enabled && budget.allowed);
  const blockedReason = cacheHit ? null : runtime.reason || budget.reason;
  let confirmationToken: string | null = null;
  let confirmationExpiresAt: string | null = null;
  if (enabled) {
    confirmationToken = crypto.randomUUID();
    confirmationExpiresAt = await createGeminiApproval({
      operationId: confirmationToken,
      actor,
      contentHash: requestIdentity.contentHash,
      batchContentHash: identity.contentHash,
      promptVersion: identity.promptVersion,
      model: identity.model,
      contentCount: requestIdentity.items.length,
      providerIds: requestIdentity.items.map((item) => item.id),
    });
  }
  return {
    confirmationToken,
    confirmationExpiresAt,
    contentHash: requestIdentity.contentHash,
    batchContentHash: identity.contentHash,
    promptVersion: identity.promptVersion,
    model: identity.model,
    contentCount: requestIdentity.items.length,
    totalContentCount: identity.items.length,
    recoveredContentCount: identity.items.length - requestIdentity.items.length,
    inputChars: requestIdentity.inputChars,
    estimatedInputTokens: requestIdentity.estimatedInputTokens,
    estimatedMaxCostUsd: requestIdentity.estimatedMaxCostUsd,
    maxNetworkAttempts: GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
    cacheHit,
    enabled,
    blockedReason,
    budget: publicBudgetSnapshot(usage),
  };
}

function usageLogBase(
  identity: ReturnType<typeof reviewIdentity>,
  requestIdentity: ReturnType<typeof reviewIdentityForItems>,
  actor: string,
  operationId: string,
) {
  return {
    operationId,
    project: process.env.GEMINI_PROJECT_LABEL || "woolimhome",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    actor,
    model: identity.model,
    promptVersion: identity.promptVersion,
    contentHash: requestIdentity.contentHash,
    batchContentHash: identity.contentHash,
    cacheKey: identity.cacheKey,
    requestCacheKey: requestIdentity.cacheKey,
    contentCount: requestIdentity.items.length,
    batchContentCount: identity.items.length,
    providerIds: requestIdentity.items.map((item) => item.id),
    estimatedInputTokens: requestIdentity.estimatedInputTokens,
  };
}

export async function runGeminiReview(rawItems: unknown, actor: string, confirmationToken: unknown) {
  if (typeof confirmationToken !== "string" || !/^[0-9a-f-]{36}$/i.test(confirmationToken)) {
    throw new Error("유효한 사전 확인 토큰이 필요합니다.");
  }
  const identity = reviewIdentity(rawItems);
  const lockId = await claimGeminiGlobalLock();
  if (!lockId) throw new Error("다른 AI 검수가 실행 중입니다. 완료 후 다시 확인해 주세요.");
  let lockOutcome: Record<string, unknown> = { operationId: confirmationToken, status: "released" };
  try {
    const progress = await reviewProgress(identity);
    const requestIdentity = progress.pendingIdentity;
    const consumed = await consumeGeminiApproval({
      operationId: confirmationToken,
      actor,
      contentHash: requestIdentity.contentHash,
      batchContentHash: identity.contentHash,
      promptVersion: identity.promptVersion,
      model: identity.model,
      contentCount: requestIdentity.items.length,
      providerIds: requestIdentity.items.map((item) => item.id),
    });
    if (!consumed) {
      throw new Error("확인이 만료되었거나 검수 대기 항목이 바뀌었습니다. 호출 내용을 다시 확인해 주세요.");
    }

    const logBase = usageLogBase(identity, requestIdentity, actor, confirmationToken);
    if (requestIdentity.items.length === 0) {
      await logGeminiCacheHit(logBase);
      lockOutcome = { operationId: confirmationToken, status: "cache_hit" };
      const result = clientReviewResult(progress.mergedResult, identity.items);
      return {
        cacheHit: true,
        ...result,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, networkAttempts: 0 },
      };
    }

    const runtime = geminiRuntimeStatus();
    if (!runtime.enabled) throw new Error(runtime.reason || "Gemini 호출이 차단되어 있습니다.");
    const usageBefore = await geminiUsageSnapshot();
    const decision = budgetDecision(
      usageBefore,
      requestIdentity.estimatedMaxCostUsd,
      undefined,
      GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
    );
    if (!decision.allowed) throw new Error(decision.reason || "Gemini 예산 상한을 초과했습니다.");

    const logId = await startGeminiUsageLog({
      ...logBase,
      networkRequest: true,
      cacheHit: false,
      estimatedCostUsd: requestIdentity.estimatedMaxCostUsd,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      usageEstimated: true,
      reservedNetworkAttempts: GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
    });
    let observedNetworkAttempts = 0;
    let observedAttempts: unknown[] = [];
    try {
      const response = await runWithGeminiInvocation({
        operationId: confirmationToken,
        actor,
        project: String(logBase.project),
        model: identity.model,
        promptVersion: identity.promptVersion,
        contentHash: requestIdentity.contentHash,
        contentCount: requestIdentity.items.length,
      }, () => generateGeminiText({
        model: identity.model,
        parts: [{ text: requestIdentity.prompt }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: GEMINI_REVIEW_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        },
        timeoutMs: 90_000,
        attempts: GEMINI_REVIEW_MAX_NETWORK_ATTEMPTS,
      }));
      observedNetworkAttempts = response.networkAttempts;
      observedAttempts = response.attempts;
      const result = parseReviewResult(response.text, requestIdentity.items);
      const mergedResult = mergeGeminiReviewResults(
        identity.items.map((item) => item.id),
        progress.providerResults,
        result.results,
      );
      const usageReported = response.usage.totalTokens > 0;
      const inputTokens = response.usage.inputTokens || requestIdentity.estimatedInputTokens;
      const outputTokens = usageReported
        ? response.usage.outputTokens
        : GEMINI_REVIEW_MAX_OUTPUT_TOKENS;
      const totalTokens = response.usage.totalTokens || inputTokens + outputTokens;
      const providerReportedCostUsd = estimatedGeminiCostUsd(inputTokens, outputTokens, geminiBudgetConfig());
      // A retryable error may still have consumed provider resources even if
      // its response includes no usage metadata. After any retry, retain the
      // full two-attempt reservation as the accounted hard-cap cost.
      const accountedCostUsd = response.networkAttempts > 1 || !usageReported
        ? requestIdentity.estimatedMaxCostUsd
        : providerReportedCostUsd;
      const reusableResults = mergedResult.results.filter((row) => row.status !== "failed");
      const completedLog = {
        inputTokens,
        outputTokens,
        totalTokens,
        cachedInputTokens: response.usage.cachedInputTokens,
        networkAttempts: response.networkAttempts,
        attempts: response.attempts,
        redactionCount: response.redactionCount,
        usageEstimated: !usageReported,
        actualCostUsd: usageReported ? providerReportedCostUsd : null,
        accountedCostUsd,
        result,
        mergedResult,
        reusableProviderIds: reusableResults.map((row) => row.id),
      };
      const cacheEntries: Array<{ cacheKey: string; value: Record<string, unknown> }> = reusableResults.map((row) => ({
        cacheKey: reviewCacheKey(row.id, identity.promptVersion, identity.model),
        value: {
          ...logBase,
          providerId: row.id,
          result: { results: [row], failedItemIds: [] },
          networkRequest: true,
          networkAttempts: response.networkAttempts,
          actualCostUsd: usageReported ? providerReportedCostUsd : null,
          accountedCostUsd,
        },
      }));
      if (mergedResult.failedItemIds.length === 0) {
        cacheEntries.push({
          cacheKey: identity.cacheKey,
          value: {
            ...logBase,
            result: mergedResult,
            networkRequest: true,
            networkAttempts: response.networkAttempts,
            actualCostUsd: usageReported ? providerReportedCostUsd : null,
            accountedCostUsd,
          },
        });
      }
      const persistence = await Promise.allSettled([
        finishGeminiUsageLog(logId, "completed", completedLog),
        writeGeminiReviewCaches(cacheEntries),
      ]);
      // The completed usage log and provider-id cache are independent recovery
      // paths. Either one prevents successful rows from being billed again.
      const cachePersisted = persistence.some((entry) => entry.status === "fulfilled");
      const clientResult = clientReviewResult(mergedResult, identity.items);
      lockOutcome = { operationId: confirmationToken, status: "completed" };
      return {
        cacheHit: false,
        ...clientResult,
        cachePersisted,
        persistenceWarning: reusableResults.length > 0 && !cachePersisted
          ? "검수 결과 저장에 실패했습니다. 같은 내용을 다시 실행하지 마세요."
          : null,
        usage: { ...response.usage, networkAttempts: response.networkAttempts },
      };
    } catch (error) {
      await finishGeminiUsageLog(logId, "failed", {
        errorCode: error instanceof GeminiRequestError ? error.code : "REVIEW_FAILED",
        errorMessage: error instanceof Error ? error.message : "AI 검수 실패",
        networkAttempts: error instanceof GeminiRequestError
          ? error.networkAttempts
          : Math.max(1, observedNetworkAttempts),
        attempts: error instanceof GeminiRequestError ? error.attempts : observedAttempts,
        usageEstimated: true,
      }).catch(() => undefined);
      lockOutcome = { operationId: confirmationToken, status: "failed" };
      throw error;
    }
  } finally {
    try {
      await releaseGeminiGlobalLock(lockId, lockOutcome);
    } catch (releaseError) {
      // Never turn a persisted provider result into a client-visible failure:
      // the fenced lease expires by itself and prevents duplicate concurrency
      // during the remaining safety window.
      console.error("[gemini-review] global lock release failed", releaseError);
    }
  }
}
