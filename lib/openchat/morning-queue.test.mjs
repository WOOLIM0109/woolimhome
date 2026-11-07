// 오전 오픈챗 줄 세우기 (lib/openchat/operations.ts 의 pickQueueCandidates).
//
// 전에는 홈페이지가 직접 게시판을 훑어서 이 줄을 채웠습니다. 2026-11-07 에
// 해외 서버에서 부산테크노파크·부산경제진흥원에 연결조차 되지 않는 것을
// 확인하고, 수집을 PC 수집기 하나로 모았습니다. 홈페이지는 이미 들어와 있는
// 공고 중에서 그날 치를 고르기만 합니다.
//
// 여기서 틀리면 그날 게시문이 비거나 지난 공고가 나갑니다.
import assert from "node:assert/strict";
import test from "node:test";

import { pickQueueCandidates } from "./morning-queue.ts";

const 지금 = Date.parse("2026-11-10T00:00:00+09:00");
const 내일 = "2026-11-11T23:59:59+09:00";
const 어제 = "2026-11-09T23:59:59+09:00";
const 대상 = "부산 소재 중소기업·소상공인";

function 공고(id, extra = {}) {
  return { id, applicant_summary: 대상, deadline_at: 내일, ...extra };
}

test("마감이 지난 공고는 줄에 세우지 않는다", () => {
  const { picked } = pickQueueCandidates(
    [공고("a"), 공고("b", { deadline_at: 어제 })],
    { now: 지금, limit: 5, carried: 0 },
  );
  assert.deepEqual(picked.map(row => row.id), ["a"]);
});

test("마감일이 없는 공고는 남겨 둔다 — 상시 모집이 있다", () => {
  const { picked } = pickQueueCandidates(
    [공고("a", { deadline_at: null })],
    { now: 지금, limit: 5, carried: 0 },
  );
  assert.deepEqual(picked.map(row => row.id), ["a"]);
});

test("날짜를 읽을 수 없는 공고는 내보내지 않는다", () => {
  const { picked } = pickQueueCandidates(
    [공고("a", { deadline_at: "접수 시까지" })],
    { now: 지금, limit: 5, carried: 0 },
  );
  assert.deepEqual(picked, []);
});

test("신청대상이 비어 있는 공고는 세우지 않고 따로 센다", () => {
  const { picked, skippedNoApplicant } = pickQueueCandidates(
    [공고("a"), 공고("b", { applicant_summary: "" }), 공고("c", { applicant_summary: "중소기업" })],
    { now: 지금, limit: 5, carried: 0 },
  );
  // "중소기업" 은 네 글자라 게시문이 빈칸이나 다름없습니다. 열 글자를 기준으로 둡니다.
  assert.deepEqual(picked.map(row => row.id), ["a"]);
  assert.equal(skippedNoApplicant, 2);
});

test("행사·교육으로 보이는 공고는 뒤로 밀되 버리지 않는다", () => {
  const { picked } = pickQueueCandidates(
    [공고("설명회", { raw_payload: { event_like: true } }), 공고("지원사업")],
    { now: 지금, limit: 5, carried: 0 },
  );
  assert.deepEqual(picked.map(row => row.id), ["지원사업", "설명회"]);
});

test("들어온 마감 순서는 그대로 지킨다", () => {
  const rows = ["1", "2", "3"].map(id => 공고(id));
  const { picked } = pickQueueCandidates(rows, { now: 지금, limit: 5, carried: 0 });
  assert.deepEqual(picked.map(row => row.id), ["1", "2", "3"]);
});

test("하루 건수의 네 배까지만 세운다", () => {
  const rows = Array.from({ length: 40 }, (_, index) => 공고(`p${index}`));
  const { picked } = pickQueueCandidates(rows, { now: 지금, limit: 5, carried: 0 });
  assert.equal(picked.length, 20);
});

test("어제 못 올려 넘어온 공고가 차지한 자리만큼 적게 세운다", () => {
  const rows = Array.from({ length: 40 }, (_, index) => 공고(`p${index}`));
  const { picked } = pickQueueCandidates(rows, { now: 지금, limit: 5, carried: 18 });
  assert.equal(picked.length, 2);
});

test("이월된 것이 자리를 다 채웠으면 새로 세우지 않는다", () => {
  const rows = Array.from({ length: 40 }, (_, index) => 공고(`p${index}`));
  const { picked } = pickQueueCandidates(rows, { now: 지금, limit: 5, carried: 99 });
  assert.deepEqual(picked, []);
});

test("고를 것이 하나도 없어도 터지지 않는다", () => {
  const { picked, skippedNoApplicant } = pickQueueCandidates([], { now: 지금, limit: 5, carried: 0 });
  assert.deepEqual(picked, []);
  assert.equal(skippedNoApplicant, 0);
});
