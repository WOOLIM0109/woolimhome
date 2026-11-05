import assert from "node:assert/strict";
import test from "node:test";
import {
  classify, duplicateGroups, groupDuplicates, jaccard, orgKey, regionCode, splitTitle,
  SAME_TITLE, SAME_TITLE_WITH_ORG, MAYBE_TITLE, DEADLINE_WINDOW_DAYS,
} from "./dedupe.ts";

const row = (changes = {}) => ({
  id: changes.id ?? "a", title: "", sourceId: "src-1",
  regions: ["전국"], deadlineAt: "2026-11-20T18:00:00+09:00", ...changes,
});

test("제목에서 해마다 달라지는 부분을 걷어낸다", () => {
  const parts = splitTitle("[경기] 2027년도 하남시 유기질비료 지원사업 추가 모집공고");
  assert.ok(!parts.tokens.has("경기"), "꼬리표는 걷어낸다");
  assert.ok(!parts.tokens.has("2027"), "연도는 걷어낸다");
  assert.ok(!parts.tokens.has("지원사업"), "흔한 낱말은 빼고 본다");
  assert.ok(parts.tokens.has("하남"), "지자체 이름은 꼬리표를 뗀 모양으로 담는다");
  assert.ok(parts.tokens.has("유기질비료"));
});

test("회차·공고호수·개정 표시를 걷어낸다", () => {
  const parts = splitTitle("공고 제2026-185호 제2차 창업도약패키지 참여기업 모집(연장)");
  assert.ok(parts.tokens.has("창업도약패키지"));
  assert.ok(!parts.tokens.has("2026"), "공고 호수는 걷어낸다");
  assert.ok(!parts.tokens.has("연장"), "개정 표시는 걷어낸다");
  for (const token of parts.tokens) assert.ok(!/^\d+$/.test(token), `숫자만 남은 낱말: ${token}`);
});

test("'기술' 의 기는 회차가 아니다", () => {
  assert.ok(splitTitle("소재부품장비 기술개발 지원").tokens.has("기술개발"));
});

test("낱말이 한 글자뿐이면 세지 않는다", () => {
  assert.equal(jaccard(new Set(), new Set(["가"])), 0);
  assert.equal(jaccard(new Set(["가", "나"]), new Set(["가", "나"])), 1);
  assert.equal(jaccard(new Set(["가", "나"]), new Set(["가", "다"])), 1 / 3);
});

test("기관명은 법인 형태 표기를 걷어내고 비교한다", () => {
  assert.equal(orgKey("주식회사 울림컴퍼니"), orgKey("㈜울림컴퍼니"));
  assert.equal(orgKey("부산경제진흥원(BEPA)"), orgKey("부산경제진흥원"));
  assert.equal(orgKey(null), "");
});

test("아는 광역 이름만 열쇠로 모으고, 나머지는 빈 글자", () => {
  assert.equal(regionCode(["경기도 하남시"]), "경기");
  assert.equal(regionCode(["충청북도"]), "충북");
  assert.equal(regionCode(["충청남도"]), "충남", "충북과 섞이지 않는다");
  assert.equal(regionCode(["전남광주통합특별시"]), "전남");
  assert.equal(regionCode(["  ", "부산"]), "부산", "빈 항목은 건너뛴다");
  // 아래는 전부 '모르는 값' 이다 — 가리는 데 쓰지 않는다.
  assert.equal(regionCode(["전국"]), "", "지역 제한이 없다는 뜻이다");
  assert.equal(regionCode(["과학기술정보통신부"]), "", "지역 칸에 들어온 부처 이름");
  assert.equal(regionCode([]), "");
  assert.equal(regionCode(null), "");
});

test("전국은 특정 지역과 부딪히지 않는다", () => {
  // 실측: LG디스플레이 공고가 기업마당 서울특별시 · K-Startup 전국으로 들어와
  // 두 줄이 됐다. 전국을 '다른 지역' 으로 읽으면 이것이 접히지 않는다.
  const title = "2027년 Dream Play LGD 스타트업 육성프로그램 9기 모집 공고";
  assert.equal(classify(
    row({ id: "a", sourceId: "bizinfo", regions: ["서울특별시"], title }),
    row({ id: "b", sourceId: "kstartup", regions: ["전국"], title: "[2027 Dream Play] LGD 스타트업 육성프로그램 9기 참가기업 모집" }),
  ), "same");
});

test("연도만 적은 네 자리도 걷어낸다", () => {
  assert.ok(!splitTitle("[2027 Dream Play] LGD 스타트업 육성프로그램").tokens.has("2027"));
  assert.ok(splitTitle("[2027 Dream Play] LGD 스타트업 육성프로그램").tokens.has("LGD"));
});

test("참가기업과 참여기업을 같은 것으로 본다", () => {
  const a = splitTitle("LGD 스타트업 육성프로그램 참가기업 모집");
  const b = splitTitle("LGD 스타트업 육성프로그램 참여기업 모집");
  assert.equal(jaccard(a.tokens, b.tokens), 1);
});

// ── 접지 말아야 하는 것 ──────────────────────────────────────────────────

test("같은 곳에서 온 두 건은 비교하지 않는다", () => {
  // 하남시·화성시 유기질비료는 둘 다 기업마당에서 온다. 이것만으로 막힌다.
  const left = row({ id: "a", title: "[경기] 하남시 2027년 유기질비료 지원사업 추가" });
  const right = row({ id: "b", title: "[경기] 하남시 2027년 유기질비료 지원사업 추가" });
  assert.equal(classify(left, right), "different");
});

test("지자체 이름이 다르면 다른 공고다", () => {
  // 지자체 이름만 다르고 나머지가 같다. 닮음은 {하남시,유기질비료} 대
  // {화성시,유기질비료} 로 1/3 이고, 지자체 이름이 겹치지 않으므로 다른 공고다.
  const left = row({ id: "a", sourceId: "src-1", regions: ["경기"], title: "[경기] 하남시 2027년 유기질비료 지원사업 추가" });
  const right = row({ id: "b", sourceId: "src-2", regions: ["경기"], title: "[경기] 화성시 2027년 유기질비료 지원사업 추가" });
  assert.equal(jaccard(splitTitle(left.title).tokens, splitTitle(right.title).tokens), 1 / 3);
  assert.deepEqual([...splitTitle(left.title).places], ["하남"]);
  assert.equal(classify(left, right), "different");
  // '시' 가 붙지 않아 지자체 장치가 안 걸리는 경우에도 닮음 1/3 로 걸러진다 —
  // 막는 장치가 겹쳐 있어야 한다.
  assert.equal(classify({ ...left, title: "하남 유기질비료 지원사업" },
    { ...right, title: "화성 유기질비료 지원사업" }), "different");
});

test("두 글자 낱말을 지자체로 읽지 않는다", () => {
  assert.deepEqual([...splitTitle("상시 모집 공군 지원 연구 지구").places], []);
  assert.deepEqual([...splitTitle("하남시 옹진군 지원").places].sort(), ["옹진", "하남"]);
});

test("같은 곳을 다르게 적어도 같은 곳으로 본다", () => {
  // 포털마다 '서울시' 와 '서울특별시' 로 적는다. 글자 그대로 보면 접어야 할
  // 두 줄이 '다른 지자체' 로 갈린다.
  assert.deepEqual([...splitTitle("서울시 창업지원").places], ["서울"]);
  assert.deepEqual([...splitTitle("서울특별시 창업지원").places], ["서울"]);
  const title = (place) => `${place} 소상공인 경영개선 바우처 참여기업 모집`;
  assert.equal(classify(
    row({ id: "a", sourceId: "src-1", title: title("서울시") }),
    row({ id: "b", sourceId: "src-2", title: title("서울특별시") }),
  ), "same");
});

test("한쪽에만 지자체 이름이 있으면 지자체로 가리지 않는다", () => {
  const left = row({ id: "a", sourceId: "src-1", title: "하남시 유기질비료 지원" });
  const right = row({ id: "b", sourceId: "src-2", title: "유기질비료 지원" });
  assert.notEqual(classify(left, right), "different", "빈칸을 '다른 지자체' 로 읽지 않는다");
});

test("지역이 둘 다 적혀 있고 다르면 다른 공고다", () => {
  const title = "창업도약패키지 참여기업 모집";
  assert.equal(classify(
    row({ id: "a", sourceId: "src-1", regions: ["부산"], title }),
    row({ id: "b", sourceId: "src-2", regions: ["경기"], title }),
  ), "different");
});

test("지역이 비어 있으면 지역으로 가리지 않는다", () => {
  const title = "창업도약패키지 참여기업 모집";
  assert.equal(classify(
    row({ id: "a", sourceId: "src-1", regions: ["부산"], title }),
    row({ id: "b", sourceId: "src-2", regions: [], title }),
  ), "same", "빈칸을 '다른 지역' 으로 읽지 않는다");
});

test("마감일이 3일 넘게 벌어지면 다른 공고다", () => {
  const title = "창업도약패키지 참여기업 모집";
  const near = new Date(Date.parse("2026-11-20T18:00:00+09:00") + DEADLINE_WINDOW_DAYS * 86_400_000).toISOString();
  const far = new Date(Date.parse("2026-11-20T18:00:00+09:00") + (DEADLINE_WINDOW_DAYS + 1) * 86_400_000 + 1).toISOString();
  assert.equal(classify(row({ id: "a", sourceId: "src-1", title }), row({ id: "b", sourceId: "src-2", title, deadlineAt: near })), "same");
  assert.equal(classify(row({ id: "a", sourceId: "src-1", title }), row({ id: "b", sourceId: "src-2", title, deadlineAt: far })), "different");
});

test("한쪽만 마감일이 비어 있으면 비교하지 않는다", () => {
  const title = "창업도약패키지 참여기업 모집";
  assert.equal(classify(
    row({ id: "a", sourceId: "src-1", title }),
    row({ id: "b", sourceId: "src-2", title, deadlineAt: null }),
  ), "different");
  assert.equal(classify(
    row({ id: "a", sourceId: "src-1", title, deadlineAt: null }),
    row({ id: "b", sourceId: "src-2", title, deadlineAt: null }),
  ), "same", "둘 다 비었으면 비교한다");
});

test("애매한 사이는 접지 않고 확인 필요로 남긴다", () => {
  const left = row({ id: "a", sourceId: "src-1", title: "부산 창업도약패키지 참여기업 모집" });
  const right = row({ id: "b", sourceId: "src-2", title: "부산 창업도약패키지 성장 참여기업 모집" });
  const verdict = classify(left, right);
  const score = jaccard(splitTitle(left.title).tokens, splitTitle(right.title).tokens);
  assert.ok(score >= MAYBE_TITLE && score < SAME_TITLE, `닮음 ${score} 가 애매한 사이여야 한다`);
  assert.equal(verdict, "maybe");
});

// ── 접어야 하는 것 ──────────────────────────────────────────────────────

test("같은 공고가 두 곳에서 올라오면 접는다", () => {
  const left = row({ id: "a", sourceId: "bizinfo", title: "2026년 LG디스플레이 Dream Play 스타트업 모집공고" });
  const right = row({ id: "b", sourceId: "kstartup", title: "LG디스플레이 Dream Play 스타트업 모집" });
  assert.equal(classify(left, right), "same");
});

test("기관명까지 같으면 기준을 낮춘다", () => {
  const left = row({ id: "a", sourceId: "src-1", orgName: "부산경제진흥원", title: "부산 창업도약패키지 참여기업 모집" });
  const right = row({ id: "b", sourceId: "src-2", orgName: "(재)부산경제진흥원", title: "부산 창업도약패키지 성장 참여기업 모집" });
  const score = jaccard(splitTitle(left.title).tokens, splitTitle(right.title).tokens);
  assert.ok(score >= SAME_TITLE_WITH_ORG && score < SAME_TITLE,
    `닮음 ${score} 가 기관명 기준과 일반 기준 사이여야 한다`);
  assert.equal(classify(left, right), "same");
  assert.equal(classify({ ...left, orgName: null }, right), "maybe", "기관명이 없으면 접지 않는다");
});

// ── 묶기 ────────────────────────────────────────────────────────────────

test("묶음 안의 모든 줄과 비교해서 하나라도 다르면 붙이지 않는다", () => {
  const title = "창업도약패키지 참여기업 모집";
  const rows = [
    row({ id: "a", sourceId: "src-1", title }),
    row({ id: "b", sourceId: "src-2", title }),
    // c 는 b 와는 닮았지만 a 와 같은 게시판이다. 사슬로 끌려들면 안 된다.
    row({ id: "c", sourceId: "src-1", title }),
  ];
  const groups = groupDuplicates(rows);
  const folded = groups.find((group) => group.members.length > 1);
  assert.deepEqual(folded.members.map((item) => item.id), ["a", "b"]);
  assert.ok(groups.some((group) => group.members.length === 1 && group.members[0].id === "c"));
});

test("한 줄짜리는 접을 거리가 아니다", () => {
  const rows = [
    row({ id: "a", sourceId: "src-1", title: "창업도약패키지 참여기업 모집" }),
    row({ id: "b", sourceId: "src-2", title: "소상공인 정책자금 융자 안내" }),
  ];
  assert.equal(duplicateGroups(rows).length, 0);
});

test("세 곳에서 올라온 같은 공고는 한 묶음이 된다", () => {
  const rows = [
    row({ id: "a", sourceId: "bizinfo", title: "2026년 LG디스플레이 Dream Play 스타트업 모집공고" }),
    row({ id: "b", sourceId: "kstartup", title: "LG디스플레이 Dream Play 스타트업 모집" }),
    row({ id: "c", sourceId: "btp", title: "LG디스플레이 Dream Play 스타트업 모집 안내" }),
  ];
  const groups = duplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((item) => item.id).sort(), ["a", "b", "c"]);
});

test("빈 제목은 아무것과도 묶이지 않는다", () => {
  const rows = [row({ id: "a", sourceId: "src-1", title: "" }), row({ id: "b", sourceId: "src-2", title: "" })];
  assert.equal(duplicateGroups(rows).length, 0);
});
