import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationEmail,
  cleanProgramTitle,
  compactSummary,
  formatDeadline,
  formatMorningPost,
  formatProgramEntry,
} from "./post-format.ts";

function 공고(overrides = {}) {
  return {
    title: "[도봉구 중소기업창업보육센터 신규 입주기업 모집 공고]",
    applicant_summary: "- ㅇ [1센터] 공고일 기준 설립 7년 미만의 중소기업 창업자(사업자등록 必)",
    support_summary: "- 지원사항 - 시세 대비 저렴한 임대료 및 보증금 지원",
    application_method: "이메일 접수 : kjiwon00@dobong.go.kr",
    source_url: "https://www.k-startup.go.kr/example",
    deadline_at: "2026-08-26T14:59:00.000Z",
    ...overrides,
  };
}

test("제목에서 대괄호와 낫표를 걷어낸다", () => {
  assert.equal(cleanProgramTitle("[도봉구 입주기업 모집 공고]"), "도봉구 입주기업 모집 공고");
  assert.equal(cleanProgramTitle("「2026년 오픈이노베이션」 모집공고"), "2026년 오픈이노베이션 모집공고");
});

test("원문에 남은 HTML 기호를 되돌린다", () => {
  // 실제 게시문에 &#039; 가 그대로 나갔습니다.
  assert.equal(cleanProgramTitle("&#039;성과기업 후속 지원&#039; 모집"), "'성과기업 후속 지원' 모집");
});

test("요약에서 원문 기호와 각주 안내를 걷어낸다", () => {
  const value = compactSummary("- ㅇ 공고일 기준 설립 7년 이내 콘텐츠 스타트업 ※ 자세한 지원내용 공고문 참조");
  assert.equal(value, "공고일 기준 설립 7년 이내 콘텐츠 스타트업");
});

test("요약이 너무 길면 자른다", () => {
  const value = compactSummary(`${"가나다라마바사 ".repeat(40)}`, 40);
  assert.ok(value.length <= 41, value.length);
  assert.ok(value.endsWith("…"));
});

test("접수는 이메일만 남기고 온라인 접수는 적지 않는다", () => {
  assert.equal(applicationEmail("이메일 접수 : kjiwon00@dobong.go.kr"), "kjiwon00@dobong.go.kr");
  assert.equal(applicationEmail("온라인 접수"), "");
  assert.equal(applicationEmail(null), "");
});

test("마감은 8/26 처럼 짧게 쓰고 시각이 있을 때만 붙인다", () => {
  assert.equal(formatDeadline("2026-08-26T14:59:00.000Z"), "8/26 23:59");
  // 한국 시각으로 자정이면 날짜만 씁니다.
  assert.equal(formatDeadline("2026-08-20T15:00:00.000Z"), "8/21");
  assert.equal(formatDeadline(null), "공고문 참조");
});

test("한 건은 제목·대상·지원·접수·마감·링크 순서로 쓴다", () => {
  const lines = formatProgramEntry(공고()).split("\n");
  assert.equal(lines[0], "도봉구 중소기업창업보육센터 신규 입주기업 모집 공고");
  assert.ok(lines[1].startsWith("대상: "));
  assert.ok(lines[2].startsWith("지원: "));
  assert.equal(lines[3], "접수: kjiwon00@dobong.go.kr");
  assert.equal(lines[4], "마감: 8/26 23:59");
  assert.equal(lines[5], "https://www.k-startup.go.kr/example");
});

test("온라인 접수 공고에는 접수 줄이 없다", () => {
  const lines = formatProgramEntry(공고({ application_method: "온라인 접수" })).split("\n");
  assert.ok(!lines.some((line) => line.startsWith("접수: ")));
  assert.equal(lines[3], "마감: 8/26 23:59");
});

test("옛 기호와 구분선은 더 이상 쓰지 않는다", () => {
  const post = formatMorningPost([공고(), 공고()], "2026-08-18");
  for (const 기호 of ["◾", "-----", "※ 자세한", "**지원내용", "◾신청기간"]) {
    assert.ok(!post.includes(기호), `${기호} 가 남아 있습니다.`);
  }
});

test("머리글과 상담 문구는 한 번씩만 붙는다", () => {
  const post = formatMorningPost([공고(), 공고()], "2026-08-18");
  assert.ok(post.startsWith("✅ 2026. 08. 18 지원사업 정보\n"));
  assert.equal(post.split("울림컴퍼니 상담").length - 1, 1);
});

test("요약이 비어 있어도 마감과 링크는 남는다", () => {
  const lines = formatProgramEntry(공고({
    applicant_summary: null,
    support_summary: "",
    application_method: null,
  })).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "마감: 8/26 23:59");
});
