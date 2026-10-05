import assert from "node:assert/strict";
import test from "node:test";
import "../testing/server-only.mjs";
const { createContactHandler } = await import("./handler.ts");
const { storeContactInquiry, recordContactNotification } = await import("./store.ts");
const { notifyContactInquiry } = await import("./notify.ts");
const { deliverContactInquiry } = await import("./deliver.ts");

const body = { name: "테스트 방문자", phone: "010-0000-0000", email: "visitor@example.com", category: "정부지원사업", message: "테스트 문의" };
function request(payload = body, headers = {}) { return new Request("https://contact.example/api/contact", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "192.0.2.1", referer: "https://contact.example/contact?private=omitted", ...headers }, body: JSON.stringify(payload) }); }
function setup({ dbError = false, missingKey = false, googleError = false } = {}) {
  const rows = [], deferred = [], emails = [], google = [];
  const client = { from(table) {
    assert.equal(table, "contact_inquiries");
    return {
      insert(value) { return { select(columns) { assert.equal(columns, "id,created_at"); return { async single() {
        if (dbError) return { data: null, error: { message: "database down" } };
        const row = { ...value, id: `inquiry-${rows.length + 1}`, created_at: "2026-10-05T00:00:00Z", notified_at: null, notify_error: null };
        rows.push(row); return { data: row, error: null };
      } }; } }; },
      update(status) { return { eq(column, id) { assert.equal(column, "id"); return { select(columns) { assert.equal(columns, "id"); return { async single() {
        const row = rows.find((item) => item.id === id);
        if (!row) return { error: { message: "missing row" }, data: null };
        Object.assign(row, status); return { data: { id }, error: null };
      } }; } }; } }; },
    };
  } };
  const handler = createContactHandler({
    store: (value) => storeContactInquiry(value, client),
    deliver: (saved, inquiry) => deliverContactInquiry(saved, inquiry, {
      notify: (saved, inquiry) => notifyContactInquiry(saved, inquiry, {
        env: { RESEND_API_KEY: missingKey ? "" : "test-only", CONTACT_NOTIFY_EMAILS: "one@example.com,two@example.com", RESEND_FROM: "contact@example.com" },
        send: async (email) => { emails.push(email); },
        record: (id, status) => recordContactNotification(id, status, client),
      }),
      google: async (value) => { google.push(value); if (googleError) throw new Error("test failure"); },
    }),
    defer: (task) => deferred.push(task),
  });
  return { handler, rows, emails, google, deferred, flush: () => Promise.all(deferred.splice(0).map((task) => task())) };
}

test("한 접수는 DB 한 행을 먼저 저장하고 200 이후 메일·구글폼을 병행한다", async () => {
  const app = setup();
  const response = await app.handler(request({ ...body, track: "injected", details: { injected: "ignored" } }));
  assert.equal(response.status, 200);
  assert.equal(app.rows.length, 1);
  assert.equal(app.emails.length, 0);
  assert.equal(app.google.length, 0);
  assert.equal(app.rows[0].track, "consulting");
  assert.deepEqual(app.rows[0].details, { category: body.category });
  assert.equal(app.rows[0].source_path, "/contact");
  assert.match(app.rows[0].requester_key, /^[a-f0-9]{64}$/);
  await app.flush();
  assert.ok(app.rows[0].notified_at);
  assert.equal(app.rows[0].notify_error, null);
  assert.deepEqual(app.emails[0].to, ["one@example.com", "two@example.com"]);
  assert.equal(app.google.length, 1);
});

test("메일 키가 없어도 DB 행·200·구글폼 병행은 유지하고 사유를 기록한다", async () => {
  const app = setup({ missingKey: true });
  assert.equal((await app.handler(request())).status, 200);
  await app.flush();
  assert.equal(app.rows.length, 1);
  assert.equal(app.rows[0].notified_at, null);
  assert.equal(app.rows[0].notify_error, "RESEND_API_KEY is missing");
  assert.equal(app.emails.length, 0);
  assert.equal(app.google.length, 1);
});

test("구글폼 제출 실패가 DB 저장과 메일 알림을 되돌리지 않는다", async () => {
  const app = setup({ googleError: true });
  assert.equal((await app.handler(request())).status, 200);
  await app.flush();
  assert.equal(app.rows.length, 1);
  assert.ok(app.rows[0].notified_at);
});

test("DB 저장 실패는 502이며 메일·구글폼 작업을 등록하지 않는다", async () => {
  const app = setup({ dbError: true });
  assert.equal((await app.handler(request())).status, 502);
  assert.equal(app.rows.length, 0);
  assert.equal(app.deferred.length, 0);
});

test("허니팟은 시간당 10회 한도를 쓰지 않으며 한도 소진 뒤에도 행 없이 200이다", async () => {
  const app = setup();
  for (let i = 0; i < 12; i++) assert.equal((await app.handler(request({ website: "bot", name: "x".repeat(1000) }))).status, 200);
  assert.equal(app.rows.length, 0);
  for (let i = 0; i < 10; i++) assert.equal((await app.handler(request())).status, 200);
  const limited = await app.handler(request({ name: "x".repeat(1000) }));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  assert.equal((await app.handler(request({ website: "bot" }))).status, 200);
  assert.equal(app.rows.length, 10);
});

test("필수값·길이·타입·이메일 오류는 저장하지 않고 400으로 답한다", async () => {
  for (const payload of [{ ...body, name: "" }, { ...body, name: "x".repeat(61) }, { ...body, message: "x".repeat(2001) }, { ...body, phone: {} }, { ...body, email: "mail\n@example.com" }, { ...body, category: "unknown" }, null, []]) {
    const app = setup();
    assert.equal((await app.handler(request(payload))).status, 400);
    assert.equal(app.rows.length, 0);
  }
});

test("기존 상담 항목을 저장 갈래에 매핑하고 외부 유입 주소는 저장하지 않는다", async () => {
  for (const [category, track] of [["소개서, 제안서 등 PPT", "business-docs"], ["디자인 서비스", "design"], ["기타문의", "etc"]]) {
    const app = setup();
    assert.equal((await app.handler(request({ ...body, category }, { referer: "https://external.example/private" }))).status, 200);
    assert.equal(app.rows[0].track, track);
    assert.equal(app.rows[0].source_path, null);
  }
});
