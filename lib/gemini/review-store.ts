import { createAdminClient } from "@/lib/supabase/admin";
import {
  geminiBudgetConfig,
  koreaUsageWindow,
  type GeminiUsageSnapshot,
} from "./protection";
import {
  addGeminiUsageSnapshots,
  aggregateGeminiUsageRows,
  type GeminiUsageRow,
} from "./usage-aggregation";
import {
  isReusableGeminiReviewCache,
  reusableGeminiReviewRows,
  type StoredGeminiReviewRow,
} from "./cache-policy";

const CACHE_CRON_NAME = "gemini-review-cache";
const APPROVAL_CRON_NAME = "gemini-review-approval";
const LOG_CRON_NAME = "gemini-review-log";
const LOCK_CRON_NAME = "gemini-review-global-lock";
const USAGE_PAGE_SIZE = 500;
const RECOVERY_MATCH_LIMIT = 3;

type Metrics = Record<string, unknown>;

function metrics(value: unknown): Metrics {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Metrics : {};
}

export type GeminiReviewProgressInput = {
  batchCacheKey: string;
  providerCacheKeys: Record<string, string>;
  promptVersion: string;
  model: string;
};

export async function findGeminiReviewProgress(input: GeminiReviewProgressInput) {
  const admin = createAdminClient();
  const providerIds = Object.keys(input.providerCacheKeys);
  const wanted = new Set(providerIds);
  const recovered = new Map<string, StoredGeminiReviewRow>();
  const cacheKeys = [...new Set([input.batchCacheKey, ...Object.values(input.providerCacheKeys)])];
  let batchCacheHit = false;

  if (cacheKeys.length > 0) {
    const { data, error } = await admin
      .from("content_automation_runs")
      .select("schedule_key,metrics")
      .eq("cron_name", CACHE_CRON_NAME)
      .eq("status", "completed")
      .in("schedule_key", cacheKeys);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const stored = metrics(row.metrics);
      if (row.schedule_key === input.batchCacheKey && isReusableGeminiReviewCache(stored)) {
        batchCacheHit = true;
      }
      for (const result of reusableGeminiReviewRows(stored)) {
        if (wanted.has(result.id) && !recovered.has(result.id)) recovered.set(result.id, result);
      }
    }
  }

  const missingProviderIds = providerIds.filter((id) => !recovered.has(id));
  const fallbackRows = await Promise.all(missingProviderIds.map(async (providerId) => {
    const { data, error } = await admin
      .from("content_automation_runs")
      .select("id,metrics")
      .eq("cron_name", LOG_CRON_NAME)
      .eq("status", "completed")
      .contains("gemini_review_provider_ids", [providerId])
      .contains("metrics", {
        networkRequest: true,
        promptVersion: input.promptVersion,
        model: input.model,
      })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(RECOVERY_MATCH_LIMIT);
    if (error) throw new Error(error.message);
    return { providerId, rows: data || [] };
  }));
  for (const { providerId, rows } of fallbackRows) {
    for (const row of rows) {
      const stored = metrics(row.metrics);
      for (const candidate of [stored.mergedResult, stored]) {
        for (const result of reusableGeminiReviewRows(candidate)) {
          if (result.id === providerId && wanted.has(result.id) && !recovered.has(result.id)) {
            recovered.set(result.id, result);
          }
        }
      }
      if (recovered.has(providerId)) break;
    }
  }

  return {
    batchCacheHit,
    providerResults: providerIds.flatMap((id) => {
      const result = recovered.get(id);
      return result ? [result] : [];
    }),
  };
}

export async function writeGeminiReviewCaches(entries: Array<{ cacheKey: string; value: Metrics }>) {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const unique = new Map(entries.map((entry) => [entry.cacheKey, entry.value]));
  const rows = [...unique].map(([cacheKey, value]) => ({
    cron_name: CACHE_CRON_NAME,
    schedule_key: cacheKey,
    status: "completed",
    scheduled_for: now,
    started_at: now,
    lease_expires_at: now,
    completed_at: now,
    metrics: value,
    updated_at: now,
  }));
  const { error } = await createAdminClient()
    .from("content_automation_runs")
    .upsert(rows, { onConflict: "cron_name,schedule_key" });
  if (error) throw new Error(error.message);
}

export async function geminiUsageSnapshot(now = new Date()): Promise<GeminiUsageSnapshot> {
  const { dailyStart, monthlyStart } = koreaUsageWindow(now);
  const admin = createAdminClient();
  let offset = 0;
  let usage: GeminiUsageSnapshot = {
    dailyCallsUsed: 0,
    monthlyCallsUsed: 0,
    dailyCostUsed: 0,
    monthlyCostUsed: 0,
  };

  // Provider logs are inserted only while holding the global Gemini lock, so
  // no other network-request row can shift these pages during the run-time
  // budget check. Avoid an app-clock upper bound because created_at uses the
  // database clock and may be slightly ahead of the server clock.
  while (true) {
    const { data, error } = await admin
      .from("content_automation_runs")
      .select("id,created_at,metrics")
      .eq("cron_name", LOG_CRON_NAME)
      .contains("metrics", { networkRequest: true })
      .gte("created_at", monthlyStart)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + USAGE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data || []) as GeminiUsageRow[];
    if (page.length === 0) break;
    usage = addGeminiUsageSnapshots(usage, aggregateGeminiUsageRows(page, dailyStart));
    offset += page.length;
  }

  return usage;
}

export async function createGeminiApproval(input: {
  operationId: string;
  actor: string;
  contentHash: string;
  batchContentHash: string;
  promptVersion: string;
  model: string;
  contentCount: number;
  providerIds: string[];
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const { error } = await createAdminClient().from("content_automation_runs").insert({
    cron_name: APPROVAL_CRON_NAME,
    schedule_key: input.operationId,
    status: "running",
    scheduled_for: now.toISOString(),
    started_at: now.toISOString(),
    lease_expires_at: expiresAt,
    metrics: input,
  });
  if (error) throw new Error(error.message);
  return expiresAt;
}

export async function consumeGeminiApproval(input: {
  operationId: string;
  actor: string;
  contentHash: string;
  batchContentHash: string;
  promptVersion: string;
  model: string;
  contentCount: number;
  providerIds: string[];
}) {
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("content_automation_runs")
    .update({ status: "completed", completed_at: now, updated_at: now })
    .eq("cron_name", APPROVAL_CRON_NAME)
    .eq("schedule_key", input.operationId)
    .eq("status", "running")
    .gt("lease_expires_at", now)
    .contains("metrics", {
      actor: input.actor,
      contentHash: input.contentHash,
      batchContentHash: input.batchContentHash,
      promptVersion: input.promptVersion,
      model: input.model,
      contentCount: input.contentCount,
      providerIds: input.providerIds,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

export type GeminiGlobalLock = {
  id: string;
  startedAt: string;
};

export async function claimGeminiGlobalLock(): Promise<GeminiGlobalLock | null> {
  const now = new Date();
  const { data, error } = await createAdminClient().rpc("claim_content_automation_run", {
    p_cron_name: LOCK_CRON_NAME,
    p_schedule_key: "singleton",
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 300,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") return null;

  const { data: lock, error: lockError } = await createAdminClient()
    .from("content_automation_runs")
    .select("id,started_at")
    .eq("id", data)
    .eq("status", "running")
    .maybeSingle();
  if (lockError) throw new Error(lockError.message);
  if (!lock?.id || !lock.started_at) return null;
  return { id: String(lock.id), startedAt: String(lock.started_at) };
}

export async function releaseGeminiGlobalLock(lock: GeminiGlobalLock, outcome: Metrics) {
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("content_automation_runs")
    .update({
      status: "skipped",
      completed_at: now,
      lease_expires_at: now,
      metrics: outcome,
      updated_at: now,
    })
    .eq("id", lock.id)
    .eq("status", "running")
    .eq("started_at", lock.startedAt);
  if (error) throw new Error(error.message);
}

export async function startGeminiUsageLog(value: Metrics) {
  const now = new Date().toISOString();
  const scheduleKey = crypto.randomUUID();
  const { data, error } = await createAdminClient().from("content_automation_runs").insert({
    cron_name: LOG_CRON_NAME,
    schedule_key: scheduleKey,
    status: "running",
    scheduled_for: now,
    started_at: now,
    lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
    metrics: value,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function finishGeminiUsageLog(logId: string, status: "completed" | "failed" | "skipped", value: Metrics) {
  const now = new Date().toISOString();
  const reusableProviderIds = status === "completed" && Array.isArray(value.reusableProviderIds)
    ? [...new Set(value.reusableProviderIds.map(String).filter(Boolean))]
    : [];
  const { data: current, error: readError } = await createAdminClient()
    .from("content_automation_runs").select("metrics").eq("id", logId).single();
  if (readError) throw new Error(readError.message);
  const { error } = await createAdminClient().from("content_automation_runs").update({
    status,
    completed_at: now,
    lease_expires_at: now,
    gemini_review_provider_ids: reusableProviderIds,
    metrics: { ...metrics(current.metrics), ...value },
    updated_at: now,
  }).eq("id", logId);
  if (error) throw new Error(error.message);
}

export async function logGeminiCacheHit(value: Metrics) {
  const logId = await startGeminiUsageLog({
    ...value,
    networkRequest: false,
    cacheHit: true,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
  });
  await finishGeminiUsageLog(logId, "completed", { networkAttempts: 0 });
}

export function publicBudgetSnapshot(usage: GeminiUsageSnapshot) {
  const config = geminiBudgetConfig();
  return {
    ...usage,
    dailyCallsLimit: config.dailyCalls,
    monthlyCallsLimit: config.monthlyCalls,
    dailyCostLimit: config.dailyCostUsd,
    monthlyCostLimit: config.monthlyCostUsd,
  };
}
