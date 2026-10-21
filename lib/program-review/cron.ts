import { createAdminClient } from "../supabase/admin";
import { runRequirementsTask } from "./requirements-runner";

type CronDependencies = {
  now: () => Date;
  isBusinessDay: (date: string) => Promise<boolean>;
  run: () => Promise<unknown>;
};

const COUNT_FIELDS = [
  "profiles", "queued", "remaining", "considered", "extracted", "reused", "matched",
  "failed", "alreadyAttempted", "budgetSkipped",
] as const;
const FLAG_FIELDS = ["refreshPending", "stoppedForTime", "budgetExhausted", "budgetBlocked", "leaseBusy", "busy"] as const;

async function reviewBusinessDay(date: string) {
  // Unlike the publication helper, a failed lookup must not permit new paid work.
  const { data, error } = await createAdminClient().from("openchat_holidays").select("holiday_date")
    .eq("holiday_date", date).abortSignal(AbortSignal.timeout(20_000)).maybeSingle();
  if (error) throw new Error("공고 검토 영업일 확인 실패");
  return !data;
}

function publicCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("공고 검토 집계 형식 오류");
  const source = value as Record<string, unknown>;
  const result: Record<string, number | boolean | string> = {
    status: ["completed", "skipped", "partial", "failed"].includes(String(source.status)) ? String(source.status) : "completed",
  };
  for (const key of COUNT_FIELDS) {
    const count = source[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  for (const key of FLAG_FIELDS) if (typeof source[key] === "boolean") result[key] = source[key];
  return result;
}

/** Scheduling guard only; the requirements runner owns the global lease and private execution log. */
export async function runProgramReviewCron(overrides: Partial<CronDependencies> = {}) {
  const now = (overrides.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) throw new Error("공고 검토 기준 시각 오류");
  const seoul = new Date(now.getTime() + 9 * 3600_000);
  const weekday = seoul.getUTCDay();
  const hour = seoul.getUTCHours();
  if (weekday === 0 || weekday === 6 || hour < 8 || hour >= 10) return { status: "skipped", skipped: true };
  const date = seoul.toISOString().slice(0, 10);
  if (!(await (overrides.isBusinessDay ?? reviewBusinessDay)(date))) return { status: "skipped", skipped: true };
  return publicCounts(await (overrides.run ?? runRequirementsTask)());
}
