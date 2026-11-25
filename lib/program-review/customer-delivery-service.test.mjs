import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
function load(url, cache = new Map()) {
  const key = String(url);
  if (cache.has(key)) return cache.get(key).exports;
  const compiled = { exports: {} }; cache.set(key, compiled);
  const source = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("module", "exports", "require", source)(compiled, compiled.exports, id => {
    if (id.startsWith(".")) return load(new URL(id.endsWith(".ts") ? id : `${id}.ts`, url), cache);
    assert.ok(!id.startsWith("@/"), `Unexpected application boundary ${id}`);
    return nativeRequire(id);
  });
  return compiled.exports;
}
const cache = new Map();
const { ProgramAdminService } = load(new URL("./admin-api.ts", import.meta.url), cache);
const { ProgramApiError } = load(new URL("./agent-auth.ts", import.meta.url), cache);

// 2026-11-26 10:30 KST
const NOW = new Date("2026-11-26T01:30:00.000Z"), TODAY = "2026-11-26";
const pid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const did = n => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const errorIs = (status, code) => error => error instanceof ProgramApiError && error.status === status && (!code || error.code === code);
const reasons = ["확인된 지역 일치: 부산", "확인된 분야 일치: 화장품"];

function fakeDatabase(now = NOW) {
  const tables = {
    openchat_programs: [1, 2, 3, 4].map(n => ({ id: pid(n), title: `가상 공고 ${n}`, source_url: `https://public.invalid/${n}`,
      deadline_at: "2026-12-18T14:59:00.000Z", status: "review_required",
      raw_payload: { collector: "gonggo-monitor", event_like: n === 4 } })),
    openchat_program_requirements: [{ program_id: pid(1), matched_profile_revision: 3, requirements: { support_amount_text: "최대 1,000만 원",
      submission_documents: [{ name: "사업자등록증" }] } }],
    openchat_program_match_context: [{ id: "current", revision: 3 }],
    openchat_program_matches: [
      // 오늘 판정. c1 은 공고 1·2 후보, c2 는 공고 1 확인 필요(빠짐)
      { program_id: pid(1), target_kind: "customer", target_id: "c1", target_name: "가상 고객 하나", verdict: "candidate", reasons, score: 10, review_date: TODAY },
      { program_id: pid(2), target_kind: "customer", target_id: "c1", target_name: "가상 고객 하나", verdict: "candidate", reasons, score: 8, review_date: TODAY },
      { program_id: pid(1), target_kind: "customer", target_id: "c2:main", target_name: "가상 사업자", verdict: "unknown", reasons: [], score: 0, review_date: TODAY },
      // 교육·행사로 표시된 공고는 넣지 않는다
      { program_id: pid(4), target_kind: "customer", target_id: "c1", target_name: "가상 고객 하나", verdict: "candidate", reasons, score: 30, review_date: TODAY },
      // 어제 판정은 쓰지 않는다
      { program_id: pid(3), target_kind: "customer", target_id: "c1", target_name: "가상 고객 하나", verdict: "candidate", reasons, score: 9, review_date: "2026-11-25" },
      // 자사 판정도 쓰지 않는다
      { program_id: pid(3), target_kind: "self", target_id: "woolim-company", target_name: "자사", verdict: "candidate", reasons, score: 9, review_date: TODAY },
    ],
    openchat_program_deliveries: [
      { id: did(1), customer_id: "c1", program_id: pid(2), review_date: "2026-11-25", delivered_by: "staff@fixture.invalid", delivered_at: "2026-11-25T02:00:00.000Z" },
      { id: did(2), customer_id: "c9", program_id: pid(3), review_date: TODAY, delivered_by: "staff@fixture.invalid", delivered_at: "2026-11-26T01:00:00.000Z" },
    ],
    openchat_match_profiles_cache: [{ payload: [{ id: "c1", name: "가상 고객 하나" }, { id: "c9", name: "가상 고객 아홉" }],
      fetched_at: "2026-11-26T00:00:00.000Z" }],
  };
  const writes = [];
  function from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    let fields = "*", single = false, start = 0, end = Infinity, op = "select", payload, options;
    const filters = [], orders = [];
    const builder = {
      select(value = "*") { fields = value; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      gte(key, value) { filters.push(row => row[key] != null && row[key] >= value); return this; },
      lte(key, value) { filters.push(row => row[key] != null && row[key] <= value); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      not(key, operator, value) { assert.equal(operator, "is"); assert.equal(value, null); filters.push(row => row[key] != null); return this; },
      order(key, opts = {}) { orders.push([key, opts.ascending !== false]); return this; },
      range(first, last) { start = first; end = last; return this; }, limit(value) { end = start + value - 1; return this; },
      maybeSingle() { single = true; return this; },
      upsert(rows, opts) { op = "upsert"; payload = rows; options = opts; return this; },
      delete() { op = "delete"; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (op === "upsert") {
            writes.push({ table, op, payload, options, fields });
            const inserted = [];
            for (const row of payload) if (!tables[table].some(have => have.customer_id === row.customer_id && have.program_id === row.program_id)) {
              tables[table].push({ id: did(tables[table].length + 10), delivered_at: NOW.toISOString(), ...row });
              inserted.push({ program_id: row.program_id });
            }
            // 충돌을 건너뛰는 upsert 는 새로 들어간 줄만 돌려준다 (PostgREST 와 같게)
            return { data: inserted, error: null };
          }
          const matched = tables[table].filter(row => filters.every(filter => filter(row)));
          if (op === "delete") {
            writes.push({ table, op, ids: matched.map(row => row.id) });
            tables[table] = tables[table].filter(row => !matched.includes(row));
            return { data: matched.map(row => ({ id: row.id })), error: null };
          }
          const rows = matched.sort((a, b) => {
            for (const [key, ascending] of orders) { if (a[key] < b[key]) return ascending ? -1 : 1; if (a[key] > b[key]) return ascending ? 1 : -1; }
            return 0;
          }).slice(start, end === Infinity ? undefined : end + 1).map(row => fields === "*" ? structuredClone(row)
            : Object.fromEntries(fields.split(",").map(field => {
              // `별칭:칸->>키` 는 JSON 안의 값을 글자로 꺼낸다
              const [alias, path] = field.trim().split(":");
              if (!path) return [alias, structuredClone(row[alias] ?? null)];
              const text = path.includes("->>");
              const [column, key] = path.split(text ? "->>" : "->");
              const value = row[column]?.[key];
              if (value === undefined || value === null) return [alias, null];
              return [alias, text ? String(value) : structuredClone(value)];
            })));
          return { data: single ? rows[0] ?? null : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  }
  const queue = { ready: 0 };
  const rpc = async (name, args) => {
    assert.equal(name, "openchat_review_queue_status");
    assert.deepEqual(args, { p_review_date: TODAY, p_include_excluded: false });
    return { data: { ...queue }, error: null };
  };
  return { tables, writes, queue, service: new ProgramAdminService({ from, rpc }, now, "https://fixture-project.supabase.co") };
}

test("오늘 판정의 후보를 고객사마다 모으고, 이미 보낸 공고는 뺀다", async () => {
  const { service } = fakeDatabase();
  const result = await service.deliveries();
  assert.equal(result.review_date, TODAY);
  assert.equal(result.customers.length, 1);
  const [c1] = result.customers;
  assert.equal(c1.customer_id, "c1");
  assert.equal(c1.customer_name, "가상 고객 하나");
  // 공고 2 는 어제 보냈고, 공고 3 은 어제 판정이라 빠진다
  assert.deepEqual(c1.items.map(item => item.program_id), [pid(1)]);
  assert.deepEqual(c1.suggested, [pid(1)]);
  assert.match(c1.message, /· 지원: 최대 1,000만 원/);
  assert.match(c1.message, /· 준비 서류: 사업자등록증/);
  // 오늘 보낸 기록은 따로 보여 준다
  assert.deepEqual(result.sent_today.map(row => [row.customer_name, row.title]), [["가상 고객 아홉", "가상 공고 3"]]);
});

test("판정이 하나도 없으면 빈 목록을 준다", async () => {
  const { tables, service } = fakeDatabase();
  tables.openchat_program_matches = [];
  const result = await service.deliveries();
  assert.equal(result.review_date, null);
  assert.deepEqual(result.customers, []);
});

test("보냈어요: 그날 그 고객사의 후보만 적고, 두 번 눌러도 한 줄이다", async () => {
  const { tables, writes, service } = fakeDatabase();
  const body = { customer_id: "c1", program_ids: [pid(1)], review_date: TODAY };
  assert.deepEqual(await service.markDelivered(body, "staff@fixture.invalid"), { delivered: 1, already: 0 });
  assert.deepEqual(await service.markDelivered(body, "staff@fixture.invalid"), { delivered: 0, already: 1 });
  assert.equal(tables.openchat_program_deliveries.filter(row => row.customer_id === "c1" && row.program_id === pid(1)).length, 1);
  // update 권한이 없는 표라 충돌은 무시하는 방식으로만 적고, 새로 적힌 줄만 돌려받는다
  assert.deepEqual(writes[0].options, { onConflict: "customer_id,program_id", ignoreDuplicates: true });
  assert.equal(writes[0].fields, "program_id");
  assert.equal(writes[0].payload[0].delivered_by, "staff@fixture.invalid");
  // 다음에 불러오면 빠져 있다
  assert.equal((await service.deliveries()).customers.length, 0);
});

test("보냈어요: 후보가 아니거나 형식이 틀리면 거절한다", async () => {
  const { tables, service } = fakeDatabase();
  const ok = { customer_id: "c1", program_ids: [pid(1)], review_date: TODAY };
  // c2 는 공고 1 이 '확인 필요' 였다
  await assert.rejects(service.markDelivered({ ...ok, customer_id: "c2" }, "staff"), errorIs(409, "NOT_A_CANDIDATE"));
  // 어제 판정 날짜로는 공고 1 이 후보가 아니었다
  await assert.rejects(service.markDelivered({ ...ok, review_date: "2026-11-25" }, "staff"), errorIs(409, "NOT_A_CANDIDATE"));
  await assert.rejects(service.markDelivered({ ...ok, extra: 1 }, "staff"), errorIs(400, "UNKNOWN_FIELD"));
  await assert.rejects(service.markDelivered({ ...ok, customer_id: " c1" }, "staff"), errorIs(400, "INVALID_DELIVERY"));
  await assert.rejects(service.markDelivered({ ...ok, program_ids: [] }, "staff"), errorIs(400, "INVALID_DELIVERY"));
  await assert.rejects(service.markDelivered({ ...ok, program_ids: ["not-a-uuid"] }, "staff"), errorIs(400));
  await assert.rejects(service.markDelivered({ ...ok, review_date: "2026-11-27" }, "staff"), errorIs(400, "INVALID_DELIVERY"));
  // 형식은 맞지만 없는 날짜
  await assert.rejects(service.markDelivered({ ...ok, review_date: "2026-02-30" }, "staff"), errorIs(400, "INVALID_DELIVERY"));
  await assert.rejects(service.markDelivered({ ...ok, customer_id: "c1:main" }, "staff"), errorIs(400, "INVALID_DELIVERY"));
  await assert.rejects(service.markDelivered(undefined, "staff"), errorIs(400, "INVALID_DELIVERY"));
  assert.equal(tables.openchat_program_deliveries.length, 2);
});

test("되돌리기: 그 기록 한 줄만 지우고, 없으면 404", async () => {
  const { tables, service } = fakeDatabase();
  assert.deepEqual(await service.undoDelivery({ id: did(1) }), { undone: 1 });
  assert.deepEqual(tables.openchat_program_deliveries.map(row => row.id), [did(2)]);
  await assert.rejects(service.undoDelivery({ id: did(1) }), errorIs(404, "DELIVERY_NOT_FOUND"));
  await assert.rejects(service.undoDelivery({ id: did(2), more: 1 }), errorIs(400, "UNKNOWN_FIELD"));
  // 되돌린 공고는 다시 문구에 들어온다
  assert.deepEqual((await service.deliveries()).customers[0].items.map(item => item.program_id), [pid(1), pid(2)]);
});

test("오늘 아직 판정하지 않은 공고와 다시 판정해야 하는 공고를 알려 준다", async () => {
  const pending = fakeDatabase();
  pending.queue.ready = 37;
  pending.tables.openchat_program_match_context[0].revision = 4;
  const result = await pending.service.deliveries();
  assert.equal(result.pending_judging, 37);
  // 화면에 보이는 공고(공고 1)만 센다
  assert.equal(result.stale_programs, 1);
  const quiet = await fakeDatabase().service.deliveries();
  assert.equal(quiet.pending_judging, 0);
  assert.equal(quiet.stale_programs, 0);
});

test("요건은 쓰는 칸만 읽는다", async () => {
  const { tables, service } = fakeDatabase();
  tables.openchat_program_requirements[0].requirements.deadline_at = "2026-12-02T09:00:00.000Z";
  const [c1] = (await service.deliveries()).customers;
  assert.equal(c1.items[0].deadline_at, "2026-12-02T09:00:00.000Z");
});
