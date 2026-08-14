import assert from "node:assert/strict";
import test from "node:test";

import { pickDistinctPrograms } from "./daily-pick.ts";

function 공고(id, title, categories = []) {
  return { id, title, categories };
}

test("정한 수만큼만 고른다", () => {
  const result = pickDistinctPrograms({
    candidates: [
      공고("a", "청년 창업 사관학교 모집"),
      공고("b", "수출 바우처 참여기업 모집"),
      공고("c", "스마트공장 구축 지원 공고"),
      공고("d", "관광 콘텐츠 개발 지원사업"),
    ],
    recent: [],
    limit: 2,
  });
  assert.equal(result.picked.length, 2);
  assert.deepEqual(result.deferred, ["c", "d"]);
});

test("최근에 내보낸 것과 닮은 공고는 뒤로 미룬다", () => {
  // 실제로 보고된 현상: 같은 사업이 지역만 바꿔 하루 걸러 올라옵니다.
  const result = pickDistinctPrograms({
    candidates: [
      공고("어제것과판박이", "2026년 농식품 중소기업 ESG 경영 도입 국제표준 인증 취득 지원사업 참여기업 모집"),
      공고("새것", "제10회 소셜벤처 혁신경연대회 참여기업 모집"),
    ],
    recent: [{ title: "2026년 농식품 중소기업 ESG 경영 도입 및 국제표준 인증 취득 지원사업 참여기업 모집 공고" }],
    limit: 1,
  });
  assert.deepEqual(result.picked.map((item) => item.id), ["새것"]);
  assert.deepEqual(result.deferred, ["어제것과판박이"]);
});

test("오늘 고른 것들끼리도 닮지 않게 한다", () => {
  const result = pickDistinctPrograms({
    candidates: [
      공고("첫째", "2026년 농식품 중소기업 기술보호 컨설팅 지원사업 참여기업 모집 공고"),
      공고("쌍둥이", "2026년 농식품 중소기업 기술보호 컨설팅 지원사업 참여기업 추가 모집 공고"),
      공고("다른것", "빅웨이브 글로벌 일본 참가기업 모집"),
    ],
    recent: [],
    limit: 2,
  });
  assert.deepEqual(result.picked.map((item) => item.id), ["첫째", "다른것"]);
});

test("닮은 것뿐이면 그래도 수를 채운다", () => {
  // 내보낼 것이 없어 빈 날이 생기면 안 됩니다.
  const result = pickDistinctPrograms({
    candidates: [
      공고("하나", "수출 바우처 참여기업 모집 공고"),
      공고("둘", "수출 바우처 참여기업 추가 모집 공고"),
      공고("셋", "수출 바우처 참여기업 재모집 공고"),
    ],
    recent: [{ title: "수출 바우처 참여기업 모집 공고" }],
    limit: 2,
  });
  assert.equal(result.picked.length, 2);
  assert.equal(result.deferred.length, 1);
});

test("고를 수가 0이면 전부 미룬다", () => {
  const result = pickDistinctPrograms({
    candidates: [공고("a", "가"), 공고("b", "나")],
    recent: [],
    limit: 0,
  });
  assert.deepEqual(result.picked, []);
  assert.deepEqual(result.deferred, ["a", "b"]);
});

test("후보가 정한 수보다 적으면 있는 만큼만 고른다", () => {
  const result = pickDistinctPrograms({
    candidates: [공고("a", "청년 창업 사관학교 모집")],
    recent: [],
    limit: 5,
  });
  assert.equal(result.picked.length, 1);
  assert.deepEqual(result.deferred, []);
});

test("분류가 겹치면 제목이 달라도 닮은 것으로 본다", () => {
  const result = pickDistinctPrograms({
    candidates: [
      공고("가", "가나다라 마바사 아자차 카타파하", ["해외인증", "수출바우처", "국제표준"]),
      공고("나", "전혀 다른 낱말로 이루어진 공고 제목", ["창업교육"]),
    ],
    recent: [{ title: "가나다라 마바사 아자차 카타파하", categories: ["해외인증", "수출바우처", "국제표준"] }],
    limit: 1,
  });
  assert.deepEqual(result.picked.map((item) => item.id), ["나"]);
});
