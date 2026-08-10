import assert from "node:assert/strict";
import test from "node:test";
import {
  addGeminiUsageSnapshots,
  aggregateGeminiUsageRows,
} from "./usage-aggregation.ts";

test("usage aggregation counts provider attempts and preserves actual cost precedence", () => {
  const usage = aggregateGeminiUsageRows([
    {
      created_at: "2026-08-10T02:00:00.000Z",
      metrics: { networkAttempts: 2, actualCostUsd: 0.25, estimatedCostUsd: 9 },
    },
    {
      created_at: "2026-08-09T14:59:59.000Z",
      metrics: { networkAttempts: 3, actualCostUsd: null, estimatedCostUsd: 0.5 },
    },
  ], "2026-08-09T15:00:00.000Z");

  assert.deepEqual(usage, {
    dailyCallsUsed: 2,
    monthlyCallsUsed: 5,
    dailyCostUsed: 0.25,
    monthlyCostUsed: 0.75,
  });
});

test("conservative accounted cost takes precedence after a retry", () => {
  const usage = aggregateGeminiUsageRows([{
    created_at: "2026-08-10T02:00:00.000Z",
    metrics: {
      networkAttempts: 2,
      actualCostUsd: 0.1,
      accountedCostUsd: 0.8,
      estimatedCostUsd: 1,
    },
  }], "2026-08-09T15:00:00.000Z");
  assert.equal(usage.dailyCallsUsed, 2);
  assert.equal(usage.dailyCostUsed, 0.8);
});

test("usage aggregation keeps explicit reservations and at least one attempt for incomplete logs", () => {
  const usage = aggregateGeminiUsageRows([
    { created_at: "2026-08-10T00:00:00.000Z", metrics: { reservedNetworkAttempts: 2 } },
    { created_at: "2026-08-10T00:01:00.000Z", metrics: { networkAttempts: 0 } },
    { created_at: "2026-08-10T00:02:00.000Z", metrics: { networkAttempts: "invalid" } },
  ], "2026-08-09T15:00:00.000Z");

  assert.equal(usage.dailyCallsUsed, 4);
  assert.equal(usage.monthlyCallsUsed, 4);
});

test("observed attempts replace a larger reservation after completion", () => {
  const usage = aggregateGeminiUsageRows([
    {
      created_at: "2026-08-10T00:00:00.000Z",
      metrics: { networkAttempts: 1, reservedNetworkAttempts: 2 },
    },
  ], "2026-08-09T15:00:00.000Z");

  assert.equal(usage.dailyCallsUsed, 1);
  assert.equal(usage.monthlyCallsUsed, 1);
});

test("usage snapshots can be accumulated page by page", () => {
  assert.deepEqual(addGeminiUsageSnapshots(
    { dailyCallsUsed: 1, monthlyCallsUsed: 2, dailyCostUsed: 0.1, monthlyCostUsed: 0.2 },
    { dailyCallsUsed: 3, monthlyCallsUsed: 4, dailyCostUsed: 0.3, monthlyCostUsed: 0.4 },
  ), {
    dailyCallsUsed: 4,
    monthlyCallsUsed: 6,
    dailyCostUsed: 0.4,
    monthlyCostUsed: 0.6000000000000001,
  });
});
