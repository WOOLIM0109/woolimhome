import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const message = { title: "포트폴리오가 멈췄습니다", body: "파미티 — 본문 작업 없음, 3일째", url: "/admin/naver-design" };

function harness({ sendDurationMs = 0, sendError = null, configured = true } = {}) {
  let clock = 1_000;
  const sends = [];
  const signals = [];
  const deletions = [];
  let reads = 0;
  class Clock extends Date {
    static now() { return clock; }
  }
  const subscriptions = ["first", "second"].map(id => ({ id, endpoint: `https://push.test/${id}`, p256dh: "key", auth: "auth" }));
  const admin = {
    from(table) {
      assert.equal(table, "openchat_push_subscriptions");
      return {
        select() {
          const query = {
            abortSignal(signal) { signals.push(signal); return query; },
            then(resolve, reject) { reads += 1; return Promise.resolve({ data: subscriptions, error: null }).then(resolve, reject); },
          };
          return query;
        },
        delete() {
          const query = {
            eq(column, value) { assert.equal(column, "id"); deletions.push(value); return query; },
            abortSignal(signal) { signals.push(signal); return query; },
            then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
          };
          return query;
        },
      };
    },
  };
  const webpush = {
    setVapidDetails() {},
    async sendNotification(subscription, payload, options) {
      sends.push({ subscription, payload, options });
      clock += sendDurationMs;
      if (sendError) throw sendError;
    },
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync("lib/notify/web-push.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "web-push") return { default: webpush };
      assert.equal(name, "@/lib/supabase/admin");
      return { createAdminClient: () => admin };
    },
    process: { env: configured ? { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" } : {} },
    Date: Clock, AbortSignal, Error,
  });
  return { sends, signals, deletions, readCount: () => reads, send: options => exports.sendAdminPush(message, options) };
}

test("a push deadline bounds the network timeout and stops before the next device", async () => {
  const h = harness({ sendDurationMs: 500 });
  const result = await h.send({ deadlineAt: 1_500 });
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].options.timeout, 500);
  assert.deepEqual(JSON.parse(h.sends[0].payload), message);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, "알림 전송 시간 부족");
  assert.equal(h.signals.length, 1);
});

test("existing callers without a deadline continue to reach every subscribed device", async () => {
  const h = harness();
  const result = await h.send();
  assert.equal(result.sent, 2);
  assert.equal(result.skipped, null);
  assert.equal(h.sends.length, 2);
  assert.ok(h.sends.every(send => send.options === undefined));
  assert.equal(h.signals.length, 0);
});

test("expired subscriptions are still removed with bounded cleanup requests", async () => {
  const h = harness({ sendError: { statusCode: 410 } });
  const result = await h.send({ deadlineAt: 1_500 });
  assert.equal(result.sent, 0);
  assert.deepEqual(h.deletions, ["first", "second"]);
  assert.equal(h.signals.length, 3);
});

test("missing VAPID keys still skip without reading subscriptions", async () => {
  const h = harness({ configured: false });
  const result = await h.send({ deadlineAt: 1_500 });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, "VAPID 키 미설정");
  assert.equal(h.readCount(), 0);
  assert.equal(h.sends.length, 0);
});
