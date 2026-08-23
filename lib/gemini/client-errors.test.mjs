import assert from "node:assert/strict";
import test from "node:test";
import { geminiErrorDetail } from "./client.ts";

test("Google 이 보낸 설명을 꺼낸다", () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
    },
  });
  assert.equal(
    geminiErrorDetail(body),
    "You exceeded your current quota, please check your plan and billing details.",
  );
});

test("JSON 이 아니면 본문 앞부분이라도 쓴다", () => {
  // 없는 것보다 낫습니다. 원인을 찾을 실마리가 하나는 남아야 합니다.
  assert.match(geminiErrorDetail("<html>Service Unavailable</html>"), /Service Unavailable/);
});

test("빈 본문에서는 아무것도 만들어내지 않는다", () => {
  assert.equal(geminiErrorDetail(""), "");
  assert.equal(geminiErrorDetail("   \n  "), "");
});

test("설명이 너무 길어도 화면을 덮지 않는다", () => {
  const body = JSON.stringify({ error: { message: "가".repeat(2_000) } });
  assert.ok(geminiErrorDetail(body).length <= 400);
});

test("error.message 가 없는 모양도 무너지지 않는다", () => {
  assert.equal(geminiErrorDetail(JSON.stringify({ error: {} })), '{"error":{}}');
  assert.equal(geminiErrorDetail("null"), "null");
});
