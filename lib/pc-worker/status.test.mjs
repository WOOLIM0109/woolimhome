import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWorkerStatus,
  summarizeWorkers,
  WORKER_HEARTBEAT_TIMEOUT_MS,
} from "./status.ts";

const NOW = Date.parse("2026-08-04T03:00:00.000Z");

function worker(overrides = {}) {
  return {
    id: "office-pc",
    display_name: "울림 사무실 PC",
    status: "online",
    current_job_id: null,
    last_seen_at: new Date(NOW - 30_000).toISOString(),
    last_error: null,
    metadata: {},
    ...overrides,
  };
}

test("최근 하트비트가 있는 작업자는 온라인으로 표시한다", () => {
  assert.deepEqual(
    deriveWorkerStatus(worker(), NOW),
    { ...worker(), online: true, busy: false },
  );
});

test("저장 상태와 관계없이 하트비트가 오래되면 오프라인으로 표시한다", () => {
  const stale = worker({
    status: "busy",
    last_seen_at: new Date(NOW - WORKER_HEARTBEAT_TIMEOUT_MS).toISOString(),
  });

  assert.equal(deriveWorkerStatus(stale, NOW).status, "offline");
  assert.equal(deriveWorkerStatus(stale, NOW).online, false);
  assert.equal(deriveWorkerStatus(stale, NOW).busy, false);
});

test("여러 PC의 온라인 및 작업 중 상태를 집계한다", () => {
  const summary = summarizeWorkers([
    worker({ id: "home-pc", display_name: "집 PC", status: "busy" }),
    worker({ id: "office-pc", display_name: "사무실 PC" }),
    worker({
      id: "old-pc",
      display_name: "이전 PC",
      last_seen_at: new Date(NOW - WORKER_HEARTBEAT_TIMEOUT_MS - 1).toISOString(),
    }),
  ], NOW);

  assert.equal(summary.online, true);
  assert.equal(summary.busy, true);
  assert.equal(summary.onlineCount, 2);
  assert.equal(summary.busyCount, 1);
  assert.equal(summary.workers[2].status, "offline");
});
