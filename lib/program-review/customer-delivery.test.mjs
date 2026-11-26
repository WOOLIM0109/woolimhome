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
const { buildCustomerDeliveries, deliveryMessage, plainReason, customerIdOf, titleForCustomer } = load(new URL("./customer-delivery.ts", import.meta.url));

const NOW = new Date("2026-11-26T01:30:00.000Z");
const pid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const program = (n, extra = {}) => ({ id: pid(n), title: `공고 ${n}`, source_url: `https://example.test/${n}`,
  deadline_at: "2026-12-18T14:59:00.000Z", status: "review_required", ...extra });
const match = (n, target, extra = {}) => ({ program_id: pid(n), target_id: target, target_name: target === "c1" ? "(주)이엘그룹" : target,
  verdict: "candidate", score: 10, reasons: ["확인된 요건 일치 2건 +10", "확인된 지역 일치: 부산", "확인된 분야 일치: 화장품"], ...extra });
const base = (over = {}) => ({ matches: [], programs: [], requirements: new Map(), delivered: new Set(),
  customerNames: new Map([["c1", "(주)이엘그룹"], ["c2", "경동종합상사"]]), now: NOW, ...over });

test("판정 이유를 고객이 읽을 말로 줄인다", () => {
  assert.equal(plainReason("확인된 지역 일치: 부산"), "지역(부산)");
  assert.equal(plainReason("확인된 분야 일치: 화장품"), "분야(화장품)");
  assert.equal(plainReason("확인된 사업자 유형 일치: 법인"), "사업자 유형(법인)");
  assert.equal(plainReason("확인된 포함 업종 일치"), "업종");
  assert.equal(plainReason("확인된 상시근로자 상한 요건 일치"), "상시근로자 상한");
  // matching.ts 가 실제로 쓰는 업력 문장 (`확인된 업력 ${label} 요건 일치: 원문 기준일 …`)
  assert.equal(plainReason("확인된 업력 최소 요건 일치: 원문 기준일 2026-01-01"), "업력");
  assert.equal(plainReason("확인된 업력 최대 요건 일치: 원문 기준일 2026-01-01"), "업력");
  assert.equal(plainReason("확인된 지역 일치: 전국 대상"), "지역(전국 대상)");
  assert.equal(plainReason("현재 인증과 일치하는 가점: 벤처기업 +3"), "가점(벤처기업)");
  assert.equal(plainReason("확인된 필수 인증 일치: 벤처기업"), "필수 인증(벤처기업)");
  assert.equal(plainReason("확인된 요건 일치 3건 +12"), null);
  assert.equal(plainReason("조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요"), null);
  assert.equal(plainReason("프로필 확인 필요(정보 부족): 업종"), null);
});

test("사업자 판정을 고객사로 묶는다", () => {
  assert.equal(customerIdOf("c2:main"), "c2");
  assert.equal(customerIdOf("c1"), "c1");
});

test("후보만, 살아 있는 공고만, 보낸 적 없는 것만 넣는다", () => {
  const result = buildCustomerDeliveries(base({
    programs: [program(1), program(2, { deadline_at: "2026-11-20T14:59:00.000Z" }), program(3, { status: "excluded" }),
      program(4), program(5, { deadline_at: null })],
    matches: [match(1, "c1"), match(2, "c1"), match(3, "c1"), match(4, "c1"), match(5, "c1"),
      match(6, "c1"), match(1, "c2:a", { verdict: "unknown" }), match(4, "c2:a", { verdict: "mismatch" })],
    delivered: new Set([`c1|${pid(4)}`]),
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].customer_name, "(주)이엘그룹");
  // 2: 마감 지남 · 3: 제외됨 · 4: 이미 보냄 · 6: 공고 정보 없음 → 빠진다. 마감 없는 5 는 뒤에 온다.
  assert.deepEqual(result[0].items.map(item => item.program_id), [pid(1), pid(5)]);
});

test("문구에 이유·지원·마감·서류·링크가 들어가고 내부 표기는 나가지 않는다", () => {
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1, { title: "[공고] 2026 화장품 원료 국산화 지원사업" })], matches: [match(1, "c1")],
    requirements: new Map([[pid(1), { support_amount_text: "최대 3,000만 원 (자부담 20%)",
      submission_documents: [{ name: "사업자등록증" }, { name: "재무제표" }, { name: "사업계획서" }, { name: "확약서" }, "사업자등록증"] }]]),
  }));
  const message = delivery.message;
  assert.match(message, /\(주\)이엘그룹에 맞는 지원사업 1건/);
  assert.match(message, /^① 2026 화장품 원료 국산화 지원사업$/m);
  assert.match(message, /· 맞는 이유: 지역\(부산\), 분야\(화장품\)/);
  assert.match(message, /· 지원: 최대 3,000만 원 \(자부담 20%\)/);
  assert.match(message, /· 마감: 12\/18 23:59/);
  assert.match(message, /· 준비 서류: 사업자등록증, 재무제표, 사업계획서 외 1건/);
  assert.match(message, /· 공고 보기: https:\/\/example\.test\/1/);
  assert.doesNotMatch(message, /확인된|\+10|candidate|조건부 후보/);
  assert.doesNotMatch(message, /확인할 점/);
});

test("조건부 후보는 뒤로 가고 확인할 점이 붙는다", () => {
  const conditional = ["확인된 지역 일치: 부산", "확인된 분야 일치: 화장품", "조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요"];
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1, { deadline_at: "2026-11-28T14:59:00.000Z" }), program(2)],
    matches: [match(1, "c1", { reasons: conditional }), match(2, "c1")],
  }));
  assert.deepEqual(delivery.items.map(item => item.program_id), [pid(2), pid(1)]);
  assert.equal(delivery.items[1].conditional, true);
  assert.match(delivery.message, /② 공고 1\n[^]*· 확인할 점: 일부 요건은 공고문으로 한 번 더 확인이 필요합니다/);
});

test("사업자가 여럿이면 한 건으로 쓰고 맞는 명의를 적는다", () => {
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1)],
    matches: [match(1, "c2:a", { target_name: "경동종합상사 · 금사점" }), match(1, "c2:b", { target_name: "경동종합상사 · 낙민점",
      reasons: ["확인된 지역 일치: 부산", "조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요"] })],
  }));
  assert.equal(delivery.items.length, 1);
  assert.deepEqual(delivery.items[0].entities, ["금사점", "낙민점"]);
  // 한 명의라도 조건 없이 후보면 조건부가 아니다
  assert.equal(delivery.items[0].conditional, false);
  assert.match(delivery.message, /· 신청 명의: 금사점, 낙민점/);
});

test("미리 고르는 것은 다섯 건까지, 목록은 서른 건까지", () => {
  const programs = Array.from({ length: 33 }, (_, i) => program(i + 1));
  const [delivery] = buildCustomerDeliveries(base({ programs, matches: programs.map((_, i) => match(i + 1, "c1")) }));
  assert.equal(delivery.items.length, 30);
  assert.equal(delivery.omitted, 3);
  assert.equal(delivery.suggested.length, 5);
  assert.match(delivery.message, /맞는 지원사업 5건/);
  assert.doesNotMatch(delivery.message, /⑥/);
});

test("지역·사업자 유형만 맞은 공고는 목록에만 두고 미리 고르지 않는다", () => {
  const weak = ["확인된 요건 일치 1건 +4", "확인된 지역 일치: 전국 대상"];
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1, { title: "[ART-AI ACADEMY] AI 숏폼 워크숍" }), program(2, { title: "수산자원보호 직불제" })],
    matches: [match(1, "c1", { reasons: weak, score: 40 }), match(2, "c1", { reasons: ["확인된 사업자 유형 일치: 소상공인"] })],
  }));
  assert.equal(delivery.items.length, 2);
  assert.ok(delivery.items.every(item => !item.strong));
  assert.deepEqual(delivery.suggested, []);
  assert.equal(delivery.message, "");
});

test("분야·업종·인증이 맞고 고객사 지역까지 맞은 것만 미리 고른다 (전국 대상은 직원이 고른다)", () => {
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1, { deadline_at: "2026-11-27T14:59:00.000Z" }), program(2), program(3), program(4), program(5)],
    matches: [
      match(1, "c1", { reasons: ["확인된 지역 일치: 부산"], score: 99 }),
      match(2, "c1", { reasons: ["확인된 지역 일치: 전국 대상", "확인된 포함 업종 일치"], score: 1 }),
      match(3, "c1", { reasons: ["확인된 지역 일치: 부산", "확인된 필수 인증 일치: 벤처기업"], score: 5 }),
      // 분야는 맞았지만 지역을 모른다 — 다른 지역 공고일 수 있다 (부산 회사에 '경기 연천군' 공고)
      match(4, "c1", { reasons: ["확인된 분야 일치: 화장품", "조건부 후보: 확인된 일치가 있으며 나머지 요건은 확인 필요"], score: 30 }),
      match(5, "c1", { reasons: ["확인된 분야 일치: 화장품"], score: 3 }),
    ],
  }));
  // 2 는 업종이 맞았지만 지역 근거가 '전국 대상' 뿐이다. 미리 고르지는 않지만, 지역을 모르는 5·4 보다는 위에 둔다.
  // 구리 창업공간·강동구 청년센터 같은 입주 공고도
  // 전국으로 읽혀 부산 회사에게 골라졌다 (2026-11-26 실제 판정) — 목록에만 둔다.
  assert.deepEqual(delivery.items.map(item => item.program_id), [pid(3), pid(2), pid(5), pid(4), pid(1)]);
  assert.deepEqual(delivery.suggested, [pid(3)]);
  const byId = id => delivery.items.find(item => item.program_id === pid(id));
  assert.equal(byId(4).region_confirmed, false);
  assert.equal(byId(2).region_confirmed, false);
  assert.equal(byId(2).nationwide, true);
  assert.equal(byId(3).nationwide, false);
  assert.equal(byId(4).nationwide, false, "지역 근거가 아예 없는 것은 전국이 아니다");
});

test("공고 칸의 마감이 비어 있으면 공고문에서 읽은 마감을 쓴다", () => {
  const result = buildCustomerDeliveries(base({
    programs: [program(1, { deadline_at: null }), program(2, { deadline_at: null })],
    matches: [match(1, "c1"), match(2, "c1")],
    requirements: new Map([[pid(1), { deadline_at: "2026-12-05T08:59:00.000Z" }], [pid(2), { deadline_at: "2026-11-20T08:59:00.000Z" }]]),
  }));
  // 공고 2 는 공고문 마감이 이미 지났다
  assert.deepEqual(result[0].items.map(item => [item.program_id, item.deadline_at]), [[pid(1), "2026-12-05T08:59:00.000Z"]]);
  assert.match(result[0].message, /· 마감: 12\/5 17:59/);
});

test("고객사 이름이 판정 뒤에 바뀌어도 신청 명의를 적는다", () => {
  const [delivery] = buildCustomerDeliveries(base({
    customerNames: new Map([["c2", "경동종합상사(새 이름)"]]), programs: [program(1)],
    matches: [match(1, "c2:a", { target_name: "경동종합상사 · 금사점" })],
  }));
  assert.deepEqual(delivery.items[0].entities, ["금사점"]);
});

test("교육·행사로 표시된 공고는 넣지 않는다", () => {
  const result = buildCustomerDeliveries(base({ programs: [program(1, { event_like: true })], matches: [match(1, "c1")] }));
  assert.deepEqual(result, []);
});

test("미리 고른 공고가 있는 고객사가 위로 온다", () => {
  const result = buildCustomerDeliveries(base({
    programs: [program(1), program(2)],
    matches: [match(1, "c1", { reasons: ["확인된 지역 일치: 부산"] }), match(2, "c2", { target_name: "경동종합상사" })],
  }));
  assert.deepEqual(result.map(row => row.customer_name), ["경동종합상사", "(주)이엘그룹"]);
});

test("고객 이름을 모르면 판정 이름에서 고객사 이름을 쓴다", () => {
  const [delivery] = buildCustomerDeliveries(base({ customerNames: new Map(), programs: [program(1)],
    matches: [match(1, "c9:x", { target_name: "새고객 · 본점" })] }));
  assert.equal(delivery.customer_name, "새고객");
});

test("뻔한 머리말만 떼고 지역 머리말은 둔다", () => {
  assert.equal(titleForCustomer("[공고] 2026 화장품 원료 지원"), "2026 화장품 원료 지원");
  assert.equal(titleForCustomer("[재공고]2026 수출 바우처"), "2026 수출 바우처");
  assert.equal(titleForCustomer("[경북] 구미시 시설자금 융자"), "[경북] 구미시 시설자금 융자");
  assert.equal(titleForCustomer("「2026 하반기 부산 원스톱」 컨설팅 &amp; 지원"), "2026 하반기 부산 원스톱 컨설팅 & 지원");
});

test("공고문에서 근거와 함께 읽은 마감을 공고 칸보다 먼저 믿는다", () => {
  const [delivery] = buildCustomerDeliveries(base({
    // 공고 칸은 게시 종료일(12/31), 공고문 접수 마감은 12/2 18:00
    programs: [program(1, { deadline_at: "2026-12-31T14:59:00.000Z" })], matches: [match(1, "c1")],
    requirements: new Map([[pid(1), { deadline_at: "2026-12-02T09:00:00.000Z" }]]),
  }));
  assert.equal(delivery.items[0].deadline_at, "2026-12-02T09:00:00.000Z");
  assert.match(delivery.message, /· 마감: 12\/2 18:00/);
});

test("사업자가 여럿이면 한 사업자 안에서 분야와 지역이 함께 맞아야 미리 고른다", () => {
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1)],
    matches: [
      match(1, "c2:a", { target_name: "경동종합상사 · 화장품법인", reasons: ["확인된 분야 일치: 화장품"] }),
      match(1, "c2:b", { target_name: "경동종합상사 · 카페", reasons: ["확인된 지역 일치: 부산"] }),
    ],
  }));
  const [item] = delivery.items;
  assert.equal(item.strong, true);
  assert.equal(item.region_confirmed, true);
  assert.equal(item.ready, false);
  assert.deepEqual(delivery.suggested, []);
});

test("전국 공고는 분야가 맞은 명의가 있어도 미리 고르지 않고, 문구에는 '전국 대상 공고' 로 적는다", () => {
  // 실제 판정: 전국 공고면 모든 명의에 '전국 대상' 이 붙는다. 분야는 명의마다 다르다.
  const [delivery] = buildCustomerDeliveries(base({
    programs: [program(1, { title: "2026년 경기창업혁신공간 북동부권(구리) 신규 입주기업 모집" })],
    matches: [
      match(1, "c2:a", { target_name: "경동종합상사 · 화장품법인", reasons: ["확인된 지역 일치: 전국 대상", "확인된 분야 일치: 화장품"] }),
      match(1, "c2:b", { target_name: "경동종합상사 · 카페", reasons: ["확인된 지역 일치: 전국 대상"] }),
    ],
  }));
  const [item] = delivery.items;
  assert.equal(item.strong, true);
  assert.equal(item.nationwide, true);
  assert.equal(item.region_confirmed, false);
  assert.equal(item.ready, false);
  assert.deepEqual(delivery.suggested, []);
  const message = deliveryMessage("경동종합상사", delivery.items);
  assert.match(message, /· 맞는 이유: 전국 대상 공고, 분야\(화장품\)/);
  assert.doesNotMatch(message, /지역\(전국 대상\)/);
});
