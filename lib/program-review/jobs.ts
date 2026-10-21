import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const COUNT_FIELDS = [
  "profiles", "queued", "remaining", "considered", "extracted", "reused", "matched", "failed",
  "alreadyAttempted", "budgetSkipped", "discovered", "discoveredAttachments", "discoveryFailed",
  "processed", "noText", "skipped", "expanded", "deferred", "zipCachePeakBytes", "zipCacheEvictions",
  "ready", "waitingAttachments", "eligible", "withText", "requirementsExtracted", "requirementsFailed",
  "pendingInputChars", "estimatedInputTokens", "estimatedOutputTokens", "remainingDailyCalls", "remainingMonthlyCalls",
  "elapsedMs", "durationMs", "remainingMs", "budgetRemainingCalls",
  "scopeProgramCount",
] as const;
const FLAG_FIELDS = ["refreshPending", "stoppedForTime", "budgetExhausted", "budgetBlocked", "leaseBusy", "busy"] as const;
type JobSummary = Record<string, number | boolean | string>;
type JobStatus = "completed" | "partial" | "blocked" | "failed";
type BusyResult = { leaseBusy: true; status: "skipped" };

function summaryOnly(value: Record<string, unknown>): JobSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("REVIEW_JOB_RESULT_INVALID");
  const summary: JobSummary = {};
  for (const key of COUNT_FIELDS) {
    const count = value[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) summary[key] = count;
  }
  for (const key of FLAG_FIELDS) if (typeof value[key] === "boolean") summary[key] = value[key];
  const date = value.date;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) summary.date = date;
  }
  return summary;
}

/** One global review lease; execution logs contain counts only, never callback data or errors. */
export async function withReviewJob<T extends Record<string, unknown>>(
  admin: SupabaseClient,
  task: "attachments" | "requirements",
  work: () => Promise<T>,
): Promise<T | BusyResult> {
  if (task !== "attachments" && task !== "requirements") throw new Error("REVIEW_JOB_TASK_INVALID");
  const owner = randomUUID();
  let jobId: string;
  try {
    const { data, error } = await admin.rpc("claim_openchat_program_review_job", { p_owner: owner, p_task: task })
      .abortSignal(AbortSignal.timeout(20_000));
    if (error) throw new Error();
    if (data === null) return { leaseBusy: true, status: "skipped" };
    if (typeof data !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data)) throw new Error();
    jobId = data;
  } catch {
    throw new Error("REVIEW_JOB_CLAIM_FAILED");
  }

  async function finish(status: JobStatus, summary: JobSummary, errorCode: string | null) {
    try {
      const { data, error } = await admin.rpc("finish_openchat_program_review_job", {
        p_job_id: jobId, p_owner: owner, p_status: status, p_summary: summary, p_error_code: errorCode,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error || data !== true) throw new Error();
    } catch {
      throw new Error("REVIEW_JOB_FINISH_FAILED");
    }
  }

  let result: T;
  let summary: JobSummary;
  try {
    result = await work();
    summary = summaryOnly(result);
  } catch (error) {
    await finish("failed", {}, "REVIEW_JOB_FAILED");
    throw error;
  }
  const status: JobStatus = typeof summary.failed === "number" && summary.failed > 0 ? "partial"
    : typeof summary.budgetSkipped === "number" && summary.budgetSkipped > 0 ? "blocked"
      : summary.refreshPending === true ? "partial" : "completed";
  await finish(status, summary, null);
  return result;
}
