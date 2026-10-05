import assert from "node:assert/strict";
import test from "node:test";
import "../testing/server-only.mjs";
const { submitGoogleForm } = await import("./google-form.ts");
const { deliverContactInquiry } = await import("./deliver.ts");
const inquiry = { track: "etc", name: "테스트", phone: "010-0000-0000", email: null, message: "문의", details: { category: "기타문의" }, source_path: "/contact", requester_key: "hash" };

test("기존 폼 토큰을 받아 같은 항목으로 병행 제출한다", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new Response(calls.length === 1 ? '<input value="token-123" name="fbzx">' : "OK");
  };
  await submitGoogleForm(inquiry, fetcher);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/viewform"));
  assert.ok(calls[1].url.endsWith("/formResponse"));
  assert.equal(calls[1].options.method, "POST");
  const body = calls[1].options.body;
  assert.equal(body.get("entry.1725469366"), inquiry.name);
  assert.equal(body.get("entry.1401280796"), inquiry.phone);
  assert.equal(body.get("entry.82188089"), "");
  assert.equal(body.get("entry.2078380745"), "기타문의");
  assert.equal(body.get("entry.1246105004"), inquiry.message);
  assert.equal(body.get("fbzx"), "token-123");
  assert.equal(body.get("partialResponse"), JSON.stringify([null, null, "token-123"]));
  assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
});

test("구글폼 마크업 변경·외부 오류를 성공으로 처리하지 않는다", async () => {
  await assert.rejects(submitGoogleForm(inquiry, async () => new Response("no token")), /token/);
  await assert.rejects(submitGoogleForm(inquiry, async () => new Response("down", { status: 503 })), /503/);
  let calls = 0;
  await assert.rejects(submitGoogleForm(inquiry, async () => ++calls === 1 ? new Response('<input name="fbzx" value="token">') : new Response("down", { status: 503 })), /503/);
});

test("메일 작업을 기다리는 동안에도 구글폼을 시작하며 한쪽 예외는 다른 쪽을 막지 않는다", async () => {
  let release, started = false;
  const pending = new Promise((resolve) => { release = resolve; });
  const task = deliverContactInquiry({ id: "test", created_at: "2026-10-05" }, inquiry, { notify: async () => pending, google: async () => { started = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, true);
  release();
  await task;
  started = false;
  await deliverContactInquiry({ id: "test", created_at: "2026-10-05" }, inquiry, { notify: () => { throw new Error("sync failure"); }, google: async () => { started = true; } });
  assert.equal(started, true);
});
