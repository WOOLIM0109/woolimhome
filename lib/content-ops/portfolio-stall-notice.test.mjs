import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { portfolioStallState } from "../portfolio/stall-state.ts";

const initialTime = Date.parse("2026-11-03T03:00:00Z");
const orphan = (id = "portfolio-1") => ({
  id, title: "250411 파미티", channel: "naver_design", format: "portfolio",
  status: "creating", review_note: null,
  updated_at: "2026-10-31T03:00:00Z",
  metadata: { portfolioStage: "design_completed" }, portfolio_jobs: [],
});

function harness({ items = [orphan()], outcomes = [], queryError = null, claimError = null } = {}) {
  let clock = initialTime;
  const claims = [];
  const runs = new Map();
  const updates = [];
  const pushes = [];
  const reads = [];
  const signals = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class Query {
    constructor(execute) { this.execute = execute; this.filters = []; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    in(column, values) { this.filters.push([column, values]); return this; }
    order() { return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    limit(count) { this.bounds = [0, count - 1]; return this; }
    abortSignal(signal) { signals.push(signal); return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute(this)).then(resolve, reject); }
  }
  const admin = {
    rpc(name, params) {
      assert.equal(name, "claim_content_automation_run");
      claims.push(params);
      return new Query(() => {
        if (claimError) return { data: null, error: { message: claimError } };
        const key = `${params.p_cron_name}:${params.p_schedule_key}`;
        const previous = runs.get(key);
        if (previous && ["completed", "running"].includes(previous.status)) return { data: null, error: null };
        const run = { id: previous?.id || `run-${runs.size + 1}`, status: "running", started_at: new Clock().toISOString() };
        runs.set(key, run);
        return { data: run.id, error: null };
      });
    },
    from(table) {
      assert.ok(["content_work_items", "content_automation_runs"].includes(table), `Unexpected table: ${table}`);
      return {
        select(columns) {
          return new Query(query => {
            reads.push({ table, columns, filters: query.filters, bounds: query.bounds });
            if (table === "content_work_items") {
              if (queryError) return { data: null, error: { message: queryError } };
              const filtered = items.filter(item => query.filters.every(([column, value]) => {
                if (column.includes(".")) return true;
                return Array.isArray(value) ? value.includes(item[column]) : item[column] === value;
              }));
              const [from, to] = query.bounds || [0, filtered.length - 1];
              return { data: filtered.slice(from, to + 1), error: null };
            }
            const records = [...runs.values()].filter(run => query.filters.every(([column, value]) => run[column] === value));
            return { data: query.one ? records[0] || null : records, error: null };
          }).select(columns);
        },
        update(values) {
          assert.equal(table, "content_automation_runs", "notices must never change a work item");
          return new Query(query => {
            updates.push({ values, filters: query.filters });
            for (const run of runs.values()) {
              if (query.filters.every(([column, value]) => run[column] === value)) Object.assign(run, values);
            }
            return { data: null, error: null };
          });
        },
      };
    },
  };
  const dependencies = {
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/portfolio/stall-state": { portfolioStallState },
    "@/lib/notify/web-push": {
      async sendAdminPush(message, options) {
        pushes.push({ message, options });
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome || { sent: 1, skipped: null };
      },
    },
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync("lib/content-ops/portfolio-stall-notice.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    Date: Clock, Error, AbortSignal, URLSearchParams, encodeURIComponent,
  });
  return {
    claims, runs, updates, pushes, reads, signals,
    setTime(value) { clock = Date.parse(value); },
    run(options) { return exports.notifyStalledPortfolios(new Clock(), options); },
  };
}

test("missing body and job send the project, reason, elapsed days, and project link", async () => {
  const item = orphan();
  const before = JSON.stringify(item);
  const h = harness({ items: [item] });
  const result = await h.run();
  assert.equal(result.sent, 1);
  assert.equal(h.pushes.length, 1);
  const { message } = h.pushes[0];
  assert.equal(message.title, "포트폴리오가 멈췄습니다");
  assert.ok(message.body.includes(item.title));
  assert.ok(message.body.includes("본문 작업 없음"));
  assert.ok(message.body.includes("3일째"));
  assert.equal(message.url, `/admin/naver-design#work-item-${item.id}`);
  assert.equal(h.claims[0].p_cron_name, "portfolio_stall_notice");
  assert.equal(h.claims[0].p_schedule_key, `2026-11-03:${item.id}`);
  assert.equal(h.updates.at(-1).values.status, "completed");
  assert.equal(JSON.stringify(item), before);
  assert.ok(h.reads[0].columns.includes("content_jobs"));
  assert.ok(h.signals.length > 0);
});

test("body and font waits below 24 hours do not claim or push", async () => {
  const h = harness({ items: [
    { ...orphan("body"), status: "draft_waiting", updated_at: "2026-11-02T04:00:00Z", portfolio_jobs: [{ id: "job" }] },
    { ...orphan("fonts"), status: "on_hold", updated_at: "2026-11-02T04:00:00Z", review_note: "MISSING_FONTS: fonts: Font A." },
  ] });
  await h.run();
  assert.equal(h.claims.length, 0);
  assert.equal(h.pushes.length, 0);
});

test("the same project is pushed once per KST date through the claim RPC", async () => {
  const h = harness();
  h.setTime("2026-11-02T15:01:00Z");
  await h.run();
  await h.run();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.claims.length, 2);
  assert.equal(h.claims[0].p_schedule_key, "2026-11-03:portfolio-1");
  assert.equal(h.claims[1].p_schedule_key, h.claims[0].p_schedule_key);
  h.setTime("2026-11-03T15:01:00Z");
  await h.run();
  assert.equal(h.pushes.length, 2);
  assert.equal(h.claims[2].p_schedule_key, "2026-11-04:portfolio-1");
});

test("overlapping invocations share the existing daily claim", async () => {
  const h = harness();
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.claims.length, 2);
  assert.equal([...h.runs.values()][0].status, "completed");
});

test("the scan reaches portfolios beyond the first page", async () => {
  const items = Array.from({ length: 51 }, (_, index) => orphan(`portfolio-${index}`));
  const h = harness({ items });
  const result = await h.run();
  assert.equal(result.checked, 51);
  assert.equal(h.pushes.length, 51);
  const pages = h.reads.filter(read => read.table === "content_work_items");
  assert.equal(pages.length, 2);
  assert.deepEqual(Array.from(pages[1].bounds), [50, 99]);
});

test("an empty list sends no all-clear message", async () => {
  const h = harness({ items: [] });
  await h.run();
  assert.equal(h.claims.length, 0);
  assert.equal(h.pushes.length, 0);
});

test("published work never causes a claim or a notice", async () => {
  const h = harness({ items: ["published", "approved", "scheduled"].map(status => ({ ...orphan(status), status })) });
  await h.run();
  assert.equal(h.claims.length, 0);
  assert.equal(h.pushes.length, 0);
});

test("push rejection closes failed and the next invocation retries", async () => {
  const h = harness({ outcomes: [new Error("push transport offline")] });
  const failed = await h.run();
  assert.equal(failed.failed, 1);
  assert.equal(h.updates.at(-1).values.status, "failed");
  assert.ok(h.updates.at(-1).values.error_message.includes("push transport offline"));
  const retried = await h.run();
  assert.equal(retried.sent, 1);
  assert.equal(h.pushes.length, 2);
  assert.equal(h.updates.at(-1).values.status, "completed");
});

test("skipped and zero-delivery push results stay retryable", async () => {
  for (const outcome of [{ sent: 0, skipped: "VAPID 키 미설정" }, { sent: 0, skipped: null }]) {
    const h = harness({ outcomes: [outcome] });
    const result = await h.run();
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.equal(h.updates.at(-1).values.status, "failed");
    await h.run();
    assert.equal(h.updates.at(-1).values.status, "completed");
  }
});

test("an unavailable claim never sends without the daily guard", async () => {
  const h = harness({ claimError: "claim unavailable" });
  const result = await h.run();
  assert.equal(h.pushes.length, 0);
  assert.equal(result.failed, 1);
  assert.ok(result.errors.some(error => error.includes("claim unavailable")));
});

test("expired invocation budget defers before scanning or sending", async () => {
  const h = harness();
  const result = await h.run({ deadlineAt: initialTime });
  assert.equal(result.deferred, true);
  assert.equal(h.reads.length, 0);
  assert.equal(h.claims.length, 0);
  assert.equal(h.pushes.length, 0);
});
