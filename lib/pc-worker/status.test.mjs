import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWorkerStatus,
  summarizeWorkers,
  WORKER_HEARTBEAT_TIMEOUT_MS,
} from "./status.ts";

const NOW = Date.parse("2026-08-04T03:00:00.000Z");

test("retired home PC is excluded from the list and all counts without changing other PCs", () => {
  const office = worker({ id: "woolim-office-pc" });
  const other = worker({ id: "another-pc", status: "busy" });
  const home = worker({ id: "becky-office-pc", status: "error" });
  assert.deepEqual(summarizeWorkers([home, office, other], NOW), summarizeWorkers([office, other], NOW));
  assert.deepEqual(summarizeWorkers([home], NOW), summarizeWorkers([], NOW));
});

function worker(overrides = {}) {
  return {
    id: "office-pc",
    display_name: "?몃┝ ?щТ??PC",
    status: "online",
    current_job_id: null,
    last_seen_at: new Date(NOW - 30_000).toISOString(),
    last_error: null,
    metadata: {},
    ...overrides,
  };
}

test("理쒓렐 ?섑듃鍮꾪듃媛 ?덈뒗 ?묒뾽?먮뒗 ?⑤씪?몄쑝濡??쒖떆?쒕떎", () => {
  assert.deepEqual(
    deriveWorkerStatus(worker(), NOW),
    { ...worker(), online: true, busy: false },
  );
});

test("????곹깭? 愿怨꾩뾾???섑듃鍮꾪듃媛 ?ㅻ옒?섎㈃ ?ㅽ봽?쇱씤?쇰줈 ?쒖떆?쒕떎", () => {
  const stale = worker({
    status: "busy",
    last_seen_at: new Date(NOW - WORKER_HEARTBEAT_TIMEOUT_MS).toISOString(),
  });

  assert.equal(deriveWorkerStatus(stale, NOW).status, "offline");
  assert.equal(deriveWorkerStatus(stale, NOW).online, false);
  assert.equal(deriveWorkerStatus(stale, NOW).busy, false);
});

test("?щ윭 PC???⑤씪??諛??묒뾽 以??곹깭瑜?吏묎퀎?쒕떎", () => {
  const summary = summarizeWorkers([
    worker({ id: "home-pc", display_name: "吏?PC", status: "busy" }),
    worker({ id: "office-pc", display_name: "?щТ??PC" }),
    worker({
      id: "old-pc",
      display_name: "?댁쟾 PC",
      last_seen_at: new Date(NOW - WORKER_HEARTBEAT_TIMEOUT_MS - 1).toISOString(),
    }),
  ], NOW);

  assert.equal(summary.online, true);
  assert.equal(summary.busy, true);
  assert.equal(summary.onlineCount, 2);
  assert.equal(summary.busyCount, 1);
  assert.equal(summary.workers[2].status, "offline");
});
