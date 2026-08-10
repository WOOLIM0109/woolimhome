import type { GeminiUsageSnapshot } from "./protection";

export type GeminiUsageRow = {
  created_at: string;
  metrics: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : null;
}

function networkAttempts(value: Record<string, unknown>) {
  return positiveInteger(value.networkAttempts)
    ?? positiveInteger(value.reservedNetworkAttempts)
    ?? 1;
}

export function aggregateGeminiUsageRows(
  rows: GeminiUsageRow[],
  dailyStart: string,
): GeminiUsageSnapshot {
  const usage: GeminiUsageSnapshot = {
    dailyCallsUsed: 0,
    monthlyCallsUsed: 0,
    dailyCostUsed: 0,
    monthlyCostUsed: 0,
  };

  for (const row of rows) {
    const value = record(row.metrics);
    const attempts = networkAttempts(value);
    const accountedCost = nonNegativeNumber(value.accountedCostUsd);
    const actualCost = nonNegativeNumber(value.actualCostUsd);
    const estimatedCost = nonNegativeNumber(value.estimatedCostUsd);
    const cost = accountedCost ?? actualCost ?? estimatedCost ?? 0;

    usage.monthlyCallsUsed += attempts;
    usage.monthlyCostUsed += cost;
    if (row.created_at >= dailyStart) {
      usage.dailyCallsUsed += attempts;
      usage.dailyCostUsed += cost;
    }
  }

  return usage;
}

export function addGeminiUsageSnapshots(
  left: GeminiUsageSnapshot,
  right: GeminiUsageSnapshot,
): GeminiUsageSnapshot {
  return {
    dailyCallsUsed: left.dailyCallsUsed + right.dailyCallsUsed,
    monthlyCallsUsed: left.monthlyCallsUsed + right.monthlyCallsUsed,
    dailyCostUsed: left.dailyCostUsed + right.dailyCostUsed,
    monthlyCostUsed: left.monthlyCostUsed + right.monthlyCostUsed,
  };
}
