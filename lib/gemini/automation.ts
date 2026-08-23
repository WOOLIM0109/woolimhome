import { createAdminClient } from "@/lib/supabase/admin";
import {
  budgetDecision,
  estimatedGeminiCostUsd,
  geminiBudgetConfig,
  geminiRuntimeStatus,
  koreaUsageWindow,
  runWithGeminiInvocation,
  sha256,
  type GeminiBudgetConfig,
  type GeminiUsageSnapshot,
} from "./protection";
import {
  addGeminiUsageSnapshots,
  aggregateGeminiUsageRows,
  type GeminiUsageRow,
} from "./usage-aggregation";
import {
  createGeminiUsageTally,
  runWithGeminiUsageTally,
} from "./usage-sink";

/**
 * 자동 원고 생성용 예산 관문.
 *
 * 관리자 AI 검수(lib/gemini/review-service.ts)는 사람이 매번 확인 버튼을 누르는 흐름이라
 * 하루 3회처럼 아주 좁은 상한을 씁니다. 원고 생성은 성격이 달라 별도 상한과 별도 원장을 씁니다.
 *
 * 이 파일이 하는 일
 * - GEMINI_ENABLED 가 꺼져 있으면 호출을 시작조차 하지 않음
 * - 남은 예산을 먼저 확인하고, 넘으면 실행하지 않음
 * - 실행 전에 예상 사용량을 원장에 미리 적어 동시 실행이 상한을 넘기지 못하게 함
 * - 끝난 뒤 실제 사용량으로 갱신
 *
 * 예산을 넘기면 자동으로 멈추므로, 요금이 정한 금액을 넘을 수 없습니다.
 */

const AUTOMATION_LOG_CRON_NAME = "gemini-automation-log";
const USAGE_PAGE_SIZE = 500;

export const GEMINI_AUTOMATION_MODEL = process.env.GEMINI_AUTOMATION_MODEL || "gemini-3.5-flash";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 원고 생성 전용 상한. 환경변수로 조정하며 배포 없이 바꿀 수 있습니다.
 * 기본값은 월 $20 기준입니다. 이전에 실제로 나가던 금액의 약 3분의 1입니다.
 */
export function automationBudgetConfig(): GeminiBudgetConfig {
  const base = geminiBudgetConfig();
  return {
    ...base,
    dailyCalls: Math.floor(positiveNumber(process.env.GEMINI_AUTOMATION_DAILY_CALL_LIMIT, 40)),
    monthlyCalls: Math.floor(positiveNumber(process.env.GEMINI_AUTOMATION_MONTHLY_CALL_LIMIT, 500)),
    dailyCostUsd: positiveNumber(process.env.GEMINI_AUTOMATION_DAILY_COST_LIMIT_USD, 2),
    monthlyCostUsd: positiveNumber(process.env.GEMINI_AUTOMATION_MONTHLY_COST_LIMIT_USD, 20),
  };
}

/** 자동 생성 원장만 합산합니다. 관리자 검수 예산과 서로 침범하지 않습니다. */
export async function automationUsageSnapshot(now = new Date()): Promise<GeminiUsageSnapshot> {
  const { dailyStart, monthlyStart } = koreaUsageWindow(now);
  const admin = createAdminClient();
  let usage: GeminiUsageSnapshot = {
    dailyCallsUsed: 0,
    monthlyCallsUsed: 0,
    dailyCostUsed: 0,
    monthlyCostUsed: 0,
  };
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from("content_automation_runs")
      .select("id,created_at,metrics")
      .eq("cron_name", AUTOMATION_LOG_CRON_NAME)
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

export class GeminiAutomationBlocked extends Error {
  code: "GEMINI_DISABLED" | "GEMINI_BUDGET_EXCEEDED";

  constructor(code: "GEMINI_DISABLED" | "GEMINI_BUDGET_EXCEEDED", message: string) {
    super(message);
    this.name = "GeminiAutomationBlocked";
    this.code = code;
  }
}

export type AutomationBudgetStatus = {
  enabled: boolean;
  reason: string | null;
  usage: GeminiUsageSnapshot;
  config: GeminiBudgetConfig;
  remainingDailyCalls: number;
  remainingMonthlyCalls: number;
  remainingMonthlyCostUsd: number;
};

/** 화면에 남은 예산을 보여줄 때 사용합니다. 호출을 일으키지 않습니다. */
export async function automationBudgetStatus(now = new Date()): Promise<AutomationBudgetStatus> {
  const runtime = geminiRuntimeStatus();
  const config = automationBudgetConfig();
  const usage = runtime.enabled
    ? await automationUsageSnapshot(now)
    : { dailyCallsUsed: 0, monthlyCallsUsed: 0, dailyCostUsed: 0, monthlyCostUsed: 0 };
  return {
    enabled: runtime.enabled,
    reason: runtime.reason,
    usage,
    config,
    remainingDailyCalls: Math.max(0, config.dailyCalls - usage.dailyCallsUsed),
    remainingMonthlyCalls: Math.max(0, config.monthlyCalls - usage.monthlyCallsUsed),
    remainingMonthlyCostUsd: Math.max(0, config.monthlyCostUsd - usage.monthlyCostUsed),
  };
}

async function startAutomationLog(metrics: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient().from("content_automation_runs").insert({
    cron_name: AUTOMATION_LOG_CRON_NAME,
    schedule_key: crypto.randomUUID(),
    status: "running",
    scheduled_for: now,
    started_at: now,
    // 작업이 도중에 끊겨도 임대가 만료되면 예약분이 예산을 계속 차지하지 않도록 합니다.
    lease_expires_at: new Date(Date.now() + 600_000).toISOString(),
    metrics,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

async function finishAutomationLog(
  logId: string,
  status: "completed" | "failed",
  metrics: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("content_automation_runs").select("metrics").eq("id", logId).maybeSingle();
  const previous = current?.metrics && typeof current.metrics === "object"
    ? current.metrics as Record<string, unknown>
    : {};
  await admin.from("content_automation_runs").update({
    status,
    completed_at: now,
    lease_expires_at: now,
    metrics: { ...previous, ...metrics },
    updated_at: now,
  }).eq("id", logId);
}

export type AutomationOperation = {
  /** 무슨 작업인지. 원장에 그대로 기록됩니다. */
  operation: string;
  /** 누가 시작했는지. 크론이면 "cron", 사람이면 이메일. */
  actor: string;
  /** 이 작업이 최대 몇 번 호출할 수 있는지. 예산을 미리 잡아 둘 때 씁니다. */
  plannedCalls?: number;
  /** 예산 확인용 예상 사용량. 실제 값은 끝난 뒤 갱신합니다. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
};

/**
 * 예산 관문을 통과한 경우에만 work()를 실행합니다.
 *
 * 상한을 넘거나 잠겨 있으면 GeminiAutomationBlocked 를 던지므로,
 * 호출하는 쪽에서 사용자에게 이유를 그대로 보여줄 수 있습니다.
 */
export async function runBudgetedGeminiAutomation<T>(
  input: AutomationOperation,
  work: () => Promise<T>,
): Promise<T> {
  const runtime = geminiRuntimeStatus();
  if (!runtime.enabled) {
    throw new GeminiAutomationBlocked(
      "GEMINI_DISABLED",
      runtime.reason || "Gemini 호출이 잠겨 있습니다.",
    );
  }

  const config = automationBudgetConfig();
  const plannedCalls = Math.max(1, Math.floor(input.plannedCalls || 1));
  const estimatedCostUsd = estimatedGeminiCostUsd(
    input.estimatedInputTokens ?? 20_000 * plannedCalls,
    input.estimatedOutputTokens ?? 6_000 * plannedCalls,
    config,
  );
  const usage = await automationUsageSnapshot();
  const decision = budgetDecision(usage, estimatedCostUsd, config, plannedCalls);
  if (!decision.allowed) {
    throw new GeminiAutomationBlocked(
      "GEMINI_BUDGET_EXCEEDED",
      // 걸린 항목의 숫자를 그대로 씁니다. 호출 횟수를 늘 붙이던 때에는
      // 비용에 걸렸는데 아직 여유가 있는 횟수가 보여 앞뒤가 맞지 않았습니다.
      [decision.reason || "Gemini 예산 상한에 도달했습니다.", decision.detail ? `(${decision.detail})` : ""]
        .filter(Boolean).join(" "),
    );
  }

  const operationId = crypto.randomUUID();
  const logId = await startAutomationLog({
    networkRequest: true,
    operation: input.operation,
    actor: input.actor,
    model: GEMINI_AUTOMATION_MODEL,
    operationId,
    reservedNetworkAttempts: plannedCalls,
    estimatedCostUsd,
  });

  const startedAt = Date.now();
  // 실제 사용량을 모아 두었다가 예약값 대신 기록합니다.
  // 이 교체가 없으면 넉넉하게 잡아 둔 예약값이 그대로 남아 상한에 훨씬 빨리 도달합니다.
  const tally = createGeminiUsageTally();

  function actualMetrics() {
    const networkAttempts = Math.max(1, tally.networkAttempts);
    return {
      networkAttempts,
      inputTokens: tally.inputTokens,
      outputTokens: tally.outputTokens,
      // 실제 호출이 있었으면 실제 사용량으로, 한 번도 없었으면 예약값을 유지합니다.
      accountedCostUsd: tally.networkAttempts > 0
        ? estimatedGeminiCostUsd(tally.inputTokens, tally.outputTokens, config)
        : estimatedCostUsd,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const value = await runWithGeminiInvocation({
      operationId,
      actor: input.actor,
      project: "woolim-content-automation",
      model: GEMINI_AUTOMATION_MODEL,
      promptVersion: `automation:${input.operation}`,
      contentHash: sha256(`${input.operation}:${operationId}`),
      contentCount: 1,
    }, () => runWithGeminiUsageTally(tally, work));
    await finishAutomationLog(logId, "completed", actualMetrics());
    return value;
  } catch (error) {
    await finishAutomationLog(logId, "failed", {
      ...actualMetrics(),
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "알 수 없는 오류",
    });
    throw error;
  }
}
