import assert from "node:assert/strict";
import test from "node:test";
import "../testing/server-only.mjs";
const { parseNotifyRecipients, buildContactEmail, notifyContactInquiry } = await import("./notify.ts");

const saved = { id: "inquiry-123", created_at: "2026-10-05T16:00:00.000Z" };
const inquiry = { track: "consulting", name: "홍길동", phone: "010-0000-0000", email: "visitor@example.com", message: "첫 줄\n<본문 원문>", details: { category: "정부지원사업", 업력: "3년" }, source_path: "/services/consulting", requester_key: "hash" };
const env = { RESEND_API_KEY: "test-only", CONTACT_NOTIFY_EMAILS: "one@example.com,two@example.com", RESEND_FROM: "상담 <contact@example.com>" };

test("수신처는 쉼표로 나누고 공백·중복을 제거하며 잘못된 주소는 거부한다", () => {
  assert.deepEqual(parseNotifyRecipients(" one@example.com, two@example.com,one@example.com, "), ["one@example.com", "two@example.com"]);
  for (const value of [undefined, "", "name", "one@example.com\nBcc:someone@example.com"]) assert.throws(() => parseNotifyRecipients(value), /CONTACT_NOTIFY_EMAILS/);
});

test("메일은 한국 날짜, 공통 항목, 전용 항목 전체, 원문과 Reply-To를 포함한다", () => {
  const email = buildContactEmail(saved, inquiry, ["one@example.com"], env.RESEND_FROM);
  assert.equal(email.subject, "[상담신청] 경영컨설팅 · 홍길동 · 2026-10-06");
  assert.equal(email.replyTo, inquiry.email);
  for (const text of [inquiry.name, inquiry.phone, inquiry.email, inquiry.source_path, "상담 분야: 정부지원사업", "업력: 3년", inquiry.message]) assert.ok(email.text.includes(text));
  assert.ok(email.text.endsWith(inquiry.message));
  assert.ok(!("html" in email));
  assert.ok(!("replyTo" in buildContactEmail(saved, { ...inquiry, email: null }, [], "sender")));
  assert.ok(!buildContactEmail(saved, { ...inquiry, name: "홍\n길동" }, [], "sender").subject.includes("\n"));
});

test("알림 발송은 두 수신처와 접수별 중복 방지 키를 전달하고 성공 시각을 저장한다", async () => {
  let payload, status;
  await notifyContactInquiry(saved, inquiry, { env, send: async (...args) => { payload = args; }, record: async (id, value) => { assert.equal(id, saved.id); status = value; } });
  assert.deepEqual(payload[0].to, ["one@example.com", "two@example.com"]);
  assert.equal(payload[1], "contact/inquiry-123");
  assert.equal(payload[2], "test-only");
  assert.ok(Number.isFinite(Date.parse(status.notified_at)));
  assert.equal(status.notify_error, null);
});

test("키 누락과 발송 실패는 미발송 사유를 기록하고 개인정보 오류를 노출하지 않는다", async () => {
  for (const missingKey of [true, false]) {
    let status;
    await notifyContactInquiry(saved, inquiry, { env: missingKey ? { ...env, RESEND_API_KEY: "" } : env, send: async () => { throw new Error("private@example.com original message"); }, record: async (_, value) => { status = value; } });
    assert.equal(status.notified_at, null);
    assert.equal(status.notify_error, missingKey ? "RESEND_API_KEY is missing" : "Resend delivery failed");
  }
});

test("Resend SDK 요청에 두 수신처·Reply-To·중복 방지 키가 실제 직렬화된다", async (t) => {
  let request, status;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "email-test" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  await notifyContactInquiry(saved, inquiry, { env, record: async (_, value) => { status = value; } });
  assert.equal(request.url, "https://api.resend.com/emails");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["one@example.com", "two@example.com"]);
  assert.equal(body.reply_to, inquiry.email);
  assert.equal(new Headers(request.options.headers).get("Idempotency-Key"), "contact/inquiry-123");
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.ok(status.notified_at);
});
