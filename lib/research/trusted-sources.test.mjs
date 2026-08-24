import assert from "node:assert/strict";
import test from "node:test";
import { normalizedSourceUrl, sameSourceUrl, trustedSourceUrl } from "./trusted-sources.ts";

test("정부·공공기관 주소는 그대로 통과한다", () => {
  for (const url of [
    "https://www.mss.go.kr/site/smba/notice.do",
    "https://www.k-startup.go.kr/web/contents/bizpbanc.do",
    "https://kosis.kr/statHtml/statHtml.do",
    "https://www.semas.or.kr/web/main.kmdc",
    "https://www.snu.ac.kr/research",
  ]) assert.equal(trustedSourceUrl(url), true, url);
});

test("언론 기사도 이제 읽는다", () => {
  /*
   * 예전에는 정부 주소만 읽었습니다. 그래서 대표가 직접 쓴 칼럼의 참고자료
   * (헤럴드경제, 아주경제, 뉴스1)조차 이 기준을 넘지 못했고, 읽을 자료가
   * 지원사업 쪽에만 있어 나오는 글도 그 주제뿐이었습니다.
   */
  for (const url of [
    "https://biz.heraldcorp.com/article/1234567",
    "https://www.ajunews.com/view/20260819",
    "https://www.news1.kr/articles/5678901",
    "https://www.yna.co.kr/view/AKR20260819",
    "https://www.mk.co.kr/news/economy/11111",
    "https://www.hankyung.com/article/2026081900",
    "https://news.kbs.co.kr/news/view.do",
  ]) assert.equal(trustedSourceUrl(url), true, url);
});

test("개인 블로그와 광고성 글은 여전히 막는다", () => {
  for (const url of [
    "https://blog.naver.com/somebody/22334455",
    "https://brunch.co.kr/@someone/12",
    "https://cafe.daum.net/anything",
    "https://tistory.com/entry/글",
    "https://medium.com/@x/y",
  ]) assert.equal(trustedSourceUrl(url), false, url);
});

test("http 는 계속 막는다", () => {
  assert.equal(trustedSourceUrl("http://www.mss.go.kr/notice"), false);
});

test("주소 표기가 달라도 같은 문서면 같은 것으로 본다", () => {
  /*
   * 이 시험이 핵심입니다. 예전에는 글자 하나까지 같아야만 인정해서, 출처를
   * 네 개 제대로 달아도 셋이 표기 차이로 날아가 "출처 2개 미만" 이 됐습니다.
   */
  const pairs = [
    ["https://www.mss.go.kr/notice/", "https://www.mss.go.kr/notice"],
    ["https://www.mss.go.kr/notice", "https://mss.go.kr/notice"],
    ["https://www.mss.go.kr/notice", "https://www.MSS.go.kr/notice"],
    ["https://www.mss.go.kr/notice?utm_source=naver", "https://www.mss.go.kr/notice"],
    ["https://www.mss.go.kr/notice#section2", "https://www.mss.go.kr/notice"],
    ["https://www.news1.kr/a/1?fbclid=xyz", "https://news1.kr/a/1"],
  ];
  for (const [left, right] of pairs) {
    assert.equal(sameSourceUrl(left, right), true, `${left} ≠ ${right}`);
  }
});

test("정말 다른 문서는 다른 것으로 본다", () => {
  assert.equal(sameSourceUrl("https://mss.go.kr/a", "https://mss.go.kr/b"), false);
  assert.equal(sameSourceUrl("https://mss.go.kr/a?page=1", "https://mss.go.kr/a?page=2"), false);
  assert.equal(sameSourceUrl("https://mss.go.kr/a", "https://kosis.kr/a"), false);
});

test("주소가 아닌 것은 아무것과도 같지 않다", () => {
  // 빈 값끼리 같다고 보면 출처 없는 글이 통과합니다.
  assert.equal(sameSourceUrl("", ""), false);
  assert.equal(sameSourceUrl("그냥 글자", "그냥 글자"), false);
  assert.equal(normalizedSourceUrl("모두의 창업 공고"), "");
});
