import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const FIXTURE_AUTH = "noncredential-cron-test-fixture";
function harness() {
  const state = { now: "2026-10-26T08:00:00+09:00", configured: true, holiday: false, holidayError: false,
    runError: false, runResult: { profiles: 2, queued: 50, remaining: 48, considered: 2, extracted: 2,
      reused: 0, matched: 2, failed: 0, budgetSkipped: 0, refreshPending: false, stoppedForTime: false } };
  const queries = [], runs = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return Date.parse(state.now); }
  }
  const admin = { from(table) {
    assert.equal(table, "openchat_holidays");
    return { select(fields) { assert.equal(fields, "holiday_date"); return this; },
      eq(key, date) { assert.equal(key, "holiday_date"); queries.push(date); return this; },
      abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
      async maybeSingle() { return { data: state.holiday ? { holiday_date: queries.at(-1) } : null,
        error: state.holidayError ? { message: "sensitive-test-marker" } : null }; } };
  } };
  const env = {}; Object.defineProperty(env, "CRON_SECRET", { get() { return state.configured ? FIXTURE_AUTH : undefined; } });
  function load(relative, dependencies) {
    const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
    }, Date: Clock, AbortSignal, Buffer, Response, process: { env } });
    return exports;
  }
  const auth = load("../cron-auth.ts", { "node:crypto": crypto, "next/server": { NextResponse: Response } });
  const cron = load("./cron.ts", { "../supabase/admin": { createAdminClient: () => admin }, "./requirements-runner": {
    async runRequirementsTask(...args) {
      runs.push(args);
      if (state.runError) throw new Error("provider raw token=sensitive-test-marker");
      return state.runResult;
    },
  } });
  const route = load("../../app/api/cron/program-review/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/cron-auth": auth, "@/lib/program-review/cron": cron,
  });
  const request = (authorization = `Bearer ${FIXTURE_AUTH}`) => new Request("https://site.example/api/cron/program-review", {
    headers: authorization ? { authorization } : {},
  });
  return { state, queries, runs, cron, route, request };
}

test("cron route rejects absent, wrong and unconfigured secrets before any database or paid work", async () => {
  const h = harness();
  for (const authorization of [null, "Bearer invalid-fixture", "Basic fixture"]) {
    const response = await h.route.GET(h.request(authorization));
    assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  h.state.configured = false;
  assert.equal((await h.route.GET(h.request())).status, 401);
  assert.equal(h.queries.length, 0); assert.equal(h.runs.length, 0);
});

test("KST weekday 08:00–09:59 guard skips nights and weekends before even looking up holidays", async () => {
  const h = harness();
  for (const time of ["2026-10-26T07:59:59+09:00", "2026-10-26T10:00:00+09:00", "2026-10-26T22:00:00+09:00",
    "2026-10-25T08:00:00+09:00", "2026-10-24T09:00:00+09:00"]) {
    h.state.now = time;
    const response = await h.route.GET(h.request());
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.status, "skipped"); assert.equal(body.skipped, true);
  }
  assert.equal(h.queries.length, 0); assert.equal(h.runs.length, 0);
});

test("UTC Sunday night and Monday midnight invocations use the Monday KST holiday date and run once", async () => {
  const h = harness();
  for (const time of ["2026-10-25T23:00:00Z", "2026-10-26T00:58:00Z", "2026-10-26T00:59:59Z"]) {
    h.state.now = time;
    const response = await h.route.GET(h.request());
    assert.equal(response.status, 200); assert.equal((await response.json()).status, "completed");
  }
  assert.deepEqual(h.queries, ["2026-10-26", "2026-10-26", "2026-10-26"]);
  assert.equal(h.runs.length, 3); assert.ok(h.runs.every(args => args.length === 0));
});

test("holidays skip and failed holiday reads fail closed without any requirements call or leaked diagnostics", async () => {
  const h = harness(); h.state.holiday = true;
  let response = await h.route.GET(h.request());
  assert.equal(response.status, 200); assert.equal((await response.json()).status, "skipped");
  h.state.holiday = false; h.state.holidayError = true;
  response = await h.route.GET(h.request());
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /sensitive-test-marker/);
  assert.equal(h.runs.length, 0);
});

test("successful response contains only validated aggregate counts and permitted control flags", async () => {
  const h = harness();
  h.state.runResult = { ...h.state.runResult, date: "sensitive-test-marker", customerName: "sensitive-test-marker",
    error: "sensitive-test-marker", providerResult: { key: "sensitive-test-marker" }, alreadyAttempted: 1,
    budgetExhausted: true, leaseBusy: false };
  const response = await h.route.GET(h.request());
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.queued, 50); assert.equal(body.remaining, 48); assert.equal(body.budgetExhausted, true);
  assert.equal(body.alreadyAttempted, 1); assert.equal(body.leaseBusy, false);
  assert.doesNotMatch(JSON.stringify(body), /sensitive-test-marker|customerName|providerResult/);
});

test("invalid aggregate values are omitted, and runner exceptions use a fixed failure response", async () => {
  const h = harness(); h.state.runResult = { profiles: "sensitive-test-marker", queued: -1, remaining: Infinity, matched: NaN, failed: 0 };
  let response = await h.route.GET(h.request());
  assert.deepEqual(await response.json(), { status: "completed", failed: 0 });
  h.state.runError = true;
  response = await h.route.GET(h.request());
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { status: "failed", failed: 1 });
});

test("global runner lease and budget flags are reported without adding a second lease or arbitrary message", async () => {
  const h = harness(); h.state.runResult = { status: "skipped", leaseBusy: true, queued: 50, remaining: 50,
    message: "sensitive-test-marker" };
  const response = await h.route.GET(h.request());
  assert.deepEqual(await response.json(), { status: "skipped", leaseBusy: true, queued: 50, remaining: 50 });
  assert.equal(h.runs.length, 1); assert.deepEqual(h.queries, ["2026-10-26"]);
});

test("invalid scheduler time fails without database reads and route retains the 300-second dynamic Node contract", async () => {
  const h = harness(); h.state.now = "invalid-time";
  assert.equal((await h.route.GET(h.request())).status, 500);
  assert.equal(h.queries.length, 0); assert.equal(h.runs.length, 0);
  assert.equal(h.route.runtime, "nodejs"); assert.equal(h.route.dynamic, "force-dynamic"); assert.equal(h.route.maxDuration, 300);
});
