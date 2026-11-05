import assert from "node:assert/strict";
import test from "node:test";
import { chooseSurvivor, foldDuplicatePrograms, DUPLICATE_REASON, FOLDABLE } from "./dedupe-fold.ts";

const NOW = new Date("2026-11-06T12:00:00+09:00");

/** 같은 공고로 묶이는 두 줄. 제목만 포털마다 다르게 적혀 있다. */
const LGD_BIZINFO = {
  id: "p-bizinfo", title: "[서울] 2027년 Dream Play(LGD 스타트업 육성프로그램 9기) 모집 공고",
  source_id: "src-bizinfo", org_name: null, regions: ["서울특별시"],
  deadline_at: "2026-11-13T14:59:00+00:00", status: "review_required",
  created_at: "2026-11-01T00:00:00Z", review_note: null,
};
const LGD_KSTARTUP = {
  id: "p-kstartup", title: "[2027 Dream Play] LGD 스타트업 육성프로그램 9기 참가기업 모집",
  source_id: "src-kstartup", org_name: null, regions: ["전국"],
  deadline_at: "2026-11-13T07:00:00+00:00", status: "published",
  created_at: "2026-10-28T00:00:00Z", review_note: null,
};

/**
 * 가짜 Supabase. `openchat_programs` 조회와 갱신, `openchat_program_requirements`
 * 조회만 답한다. 갱신은 기록만 하고 조회 결과는 바꾸지 않는다 — 한 번 돌리는
 * 동안 목록이 흔들리면 안 된다.
 */
function fakeAdmin({ programs = [], extracted = [] } = {}) {
  const updates = [];
  const admin = {
    from(table) {
      const builder = {
        _filters: {},
        select() { return builder; },
        neq() { return builder; },
        gte() { return builder; },
        or() { return builder; },
        order() { return builder; },
        in() { return builder; },
        eq(column, value) { builder._filters[column] = value; return builder; },
        update(values) { builder._update = values; return builder; },
        then(resolve) {
          if (builder._update) {
            updates.push({ id: builder._filters.id, values: builder._update });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (table === "openchat_programs") return Promise.resolve({ data: programs, error: null }).then(resolve);
          if (table === "openchat_program_requirements") {
            return Promise.resolve({ data: extracted, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin, updates };
}

const run = (options) => foldDuplicatePrograms({ admin: fakeAdmin(options).admin, now: () => NOW });

// ── 남길 줄 고르기 ───────────────────────────────────────────────────────

const candidate = (changes = {}) => ({
  id: "a", title: "제목", sourceId: "src", orgName: null, regions: null,
  deadlineAt: null, status: "review_required", createdAt: "2026-11-01T00:00:00Z",
  reviewNote: null, extractedAt: null, ...changes,
});

test("요건을 뽑아 둔 줄을 남긴다", () => {
  const withRequirements = candidate({ id: "b", extractedAt: "2026-11-05T00:00:00Z" });
  const plain = candidate({ id: "a", createdAt: "2026-01-01T00:00:00Z" });
  assert.equal(chooseSurvivor([plain, withRequirements]).id, "b", "먼저 들어온 줄보다 요건이 우선이다");
});

test("둘 다 요건이 있으면 최근에 뽑은 줄을 남긴다", () => {
  const old = candidate({ id: "a", extractedAt: "2026-10-01T00:00:00Z" });
  const fresh = candidate({ id: "b", extractedAt: "2026-11-05T00:00:00Z" });
  assert.equal(chooseSurvivor([old, fresh]).id, "b");
});

test("요건이 없으면 주관기관이 적힌 줄을 남긴다", () => {
  const plain = candidate({ id: "a", createdAt: "2026-01-01T00:00:00Z" });
  const withOrg = candidate({ id: "b", orgName: "부산테크노파크" });
  assert.equal(chooseSurvivor([plain, withOrg]).id, "b");
});

test("그 외에는 먼저 들어온 줄을 남긴다", () => {
  const first = candidate({ id: "a", createdAt: "2026-10-01T00:00:00Z" });
  const later = candidate({ id: "b", createdAt: "2026-11-01T00:00:00Z" });
  assert.equal(chooseSurvivor([first, later]).id, "a");
  assert.equal(chooseSurvivor([later, first]).id, "a", "넘어온 순서가 바뀌어도 같은 답이다");
});

test("사람이 판단을 내린 줄은 요건이 있는 줄보다도 먼저 남는다", () => {
  const approved = candidate({ id: "a", status: "approved" });
  const withRequirements = candidate({ id: "b", extractedAt: "2026-11-05T00:00:00Z" });
  assert.equal(chooseSurvivor([withRequirements, approved]).id, "a");
});

test("사람 판단이 둘이면 아무것도 고르지 않는다", () => {
  assert.equal(chooseSurvivor([
    candidate({ id: "a", status: "approved" }),
    candidate({ id: "b", status: "ready" }),
  ]), null, "기계가 사람 판단을 지우면 안 된다");
});

test("발행된 줄은 접어도 되는 상태다", () => {
  assert.ok(FOLDABLE.has("published"));
  assert.ok(!FOLDABLE.has("approved"));
  assert.ok(!FOLDABLE.has("ready"));
  assert.ok(!FOLDABLE.has("deferred"));
});

// ── 실제로 접기 ─────────────────────────────────────────────────────────

test("LG디스플레이 두 줄을 한 줄로 접는다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [LGD_BIZINFO, LGD_KSTARTUP],
    extracted: [{ program_id: "p-kstartup", extracted_at: "2026-11-05T00:00:00Z" }],
  });
  const result = await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.deepEqual(result, { considered: 2, groups: 1, folded: 1, skipped: 0 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "p-bizinfo", "요건이 있는 K-Startup 줄을 남긴다");
  assert.equal(updates[0].values.status, "excluded");
  assert.equal(updates[0].values.exclusion_reason, DUPLICATE_REASON);
  assert.match(updates[0].values.review_note, /같은 공고로 접었습니다/);
  assert.match(updates[0].values.review_note, /p-kstartup/, "어느 줄로 접었는지 남긴다");
});

test("사람이 적어 둔 메모는 지우지 않는다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [{ ...LGD_BIZINFO, review_note: "대표님 확인 필요" }, LGD_KSTARTUP],
    extracted: [{ program_id: "p-kstartup", extracted_at: "2026-11-05T00:00:00Z" }],
  });
  await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.match(updates[0].values.review_note, /^대표님 확인 필요/);
  assert.match(updates[0].values.review_note, /p-kstartup/);
});

test("지우지 않는다 — 되살릴 수 있는 사유만 남긴다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [LGD_BIZINFO, LGD_KSTARTUP],
    extracted: [{ program_id: "p-kstartup", extracted_at: "2026-11-05T00:00:00Z" }],
  });
  await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.deepEqual(Object.keys(updates[0].values).sort(),
    ["exclusion_reason", "review_note", "status", "updated_at"],
    "제목·마감·요건은 건드리지 않는다");
});

test("같은 곳에서 온 두 건은 접지 않는다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [
      { ...LGD_BIZINFO, id: "a" },
      { ...LGD_BIZINFO, id: "b", title: LGD_KSTARTUP.title },
    ],
  });
  const result = await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.equal(result.groups, 0);
  assert.equal(updates.length, 0);
});

test("지자체만 다른 공고는 접지 않는다", async () => {
  const base = { ...LGD_BIZINFO, org_name: null, regions: ["경기도"] };
  const { admin, updates } = fakeAdmin({
    programs: [
      { ...base, id: "a", source_id: "src-1", title: "[경기] 하남시 2027년 유기질비료 지원사업 추가ㆍ변경 신청 공고" },
      { ...base, id: "b", source_id: "src-2", title: "[경기] 화성시 2027년 유기질비료 지원사업 추가ㆍ변경 신청 공고" },
    ],
  });
  const result = await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.equal(result.folded, 0);
  assert.equal(updates.length, 0);
});

test("사람 판단이 둘인 묶음은 손대지 않고 세어만 둔다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [
      { ...LGD_BIZINFO, status: "approved" },
      { ...LGD_KSTARTUP, status: "ready" },
    ],
  });
  const result = await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.deepEqual(result, { considered: 2, groups: 1, folded: 0, skipped: 1 });
  assert.equal(updates.length, 0);
});

test("세 곳에서 올라왔으면 두 줄을 접는다", async () => {
  const { admin, updates } = fakeAdmin({
    programs: [
      LGD_BIZINFO, LGD_KSTARTUP,
      { ...LGD_KSTARTUP, id: "p-btp", source_id: "src-btp", status: "review_required",
        title: "2027 Dream Play LGD 스타트업 육성프로그램 9기 모집 안내" },
    ],
    extracted: [{ program_id: "p-kstartup", extracted_at: "2026-11-05T00:00:00Z" }],
  });
  const result = await foldDuplicatePrograms({ admin, now: () => NOW });
  assert.equal(result.groups, 1);
  assert.equal(result.folded, 2);
  assert.deepEqual(updates.map((row) => row.id).sort(), ["p-bizinfo", "p-btp"]);
});

test("한 줄뿐이면 아무것도 하지 않는다", async () => {
  assert.deepEqual(await run({ programs: [LGD_BIZINFO] }),
    { considered: 1, groups: 0, folded: 0, skipped: 0 });
  assert.deepEqual(await run({ programs: [] }),
    { considered: 0, groups: 0, folded: 0, skipped: 0 });
});

test("조회가 실패하면 조용히 넘어가지 않는다", async () => {
  const admin = { from: () => ({
    select: () => admin.from(), neq: () => admin.from(), gte: () => admin.from(),
    or: () => admin.from(), order: () => admin.from(),
    then: (resolve) => Promise.resolve({ data: null, error: { message: "권한 없음" } }).then(resolve),
  }) };
  await assert.rejects(() => foldDuplicatePrograms({ admin, now: () => NOW }), /공고 조회 실패/);
});
