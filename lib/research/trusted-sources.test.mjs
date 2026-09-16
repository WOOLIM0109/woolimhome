import assert from "node:assert/strict";
import test from "node:test";
import { normalizedSourceUrl, sameHost, sameSourceUrl, trustedSourceUrl } from "./trusted-sources.ts";

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

test("같은 기관의 깊은 페이지를 같은 곳으로 본다", () => {
  /*
   * 08-26 컨설팅 글에서 실제로 버려진 주소입니다. 조사가 이 원문을 찾아왔는데
   * 목록의 law.go.kr 과 글자가 안 맞아 없는 것이 되었고, 글에는 대문 주소만
   * 실렸습니다. 독자는 근거 페이지로 갈 수 없었습니다.
   */
  assert.equal(
    sameHost("https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000222488",
      "https://law.go.kr"),
    true,
  );
});

test("www 유무와 http/https 는 같은 곳으로 본다", () => {
  assert.equal(sameHost("http://mss.go.kr/a/b", "https://www.mss.go.kr"), true);
  assert.equal(sameHost("https://WWW.MSS.GO.KR/", "https://mss.go.kr/x?y=1"), true);
});

test("다른 기관은 갈라 낸다", () => {
  assert.equal(sameHost("https://law.go.kr", "https://mss.go.kr"), false);
  // 하위 도메인은 다른 곳입니다. 여기서 느슨해지면 blog.naver.com 이 들어옵니다.
  assert.equal(sameHost("https://blog.naver.com/x", "https://naver.com"), false);
});

test("읽을 수 없는 주소는 같다고 하지 않는다", () => {
  assert.equal(sameHost("", "https://law.go.kr"), false);
  assert.equal(sameHost("주소 아님", "주소 아님"), false);
});

test("개인 블로그는 출처로 인정하지 않는다", () => {
  /*
   * 티스토리는 플랫폼입니다. 대학교수의 정리 글과 경쟁사 광고가 같은 꼬리를
   * 씁니다. 도메인으로 품질을 가릴 수 없어 넣으면 기준 자체가 무너집니다.
   * 조사 단계는 지금도 읽습니다 — 맥락은 얻되 본문 근거로만 안 씁니다.
   */
  assert.equal(trustedSourceUrl("https://happy-dreamer7301.tistory.com/entry/x"), false);
  assert.equal(trustedSourceUrl("https://blog.naver.com/wl_0109/1"), false);
  assert.equal(trustedSourceUrl("https://www.guard1004.com/430"), false);
  assert.equal(trustedSourceUrl("https://brunch.co.kr/@x/1"), false);
});

test("디자인·문서 표준을 내는 곳은 인정한다", () => {
  // 인쇄 규격·색·문서 형식은 한국 정부 사이트에 없는 것이 많습니다.
  for (const url of [
    "https://helpx.adobe.com/kr/indesign/using/printing-documents.html",
    "https://support.microsoft.com/ko-kr/powerpoint",
    "https://www.pantone.com/color-systems",
    "https://www.w3.org/WAI/standards-guidelines/wcag/",
    "https://m3.material.io/foundations/layout",
    "https://www.nngroup.com/articles/typography/",
  ]) {
    assert.equal(trustedSourceUrl(url), true, `${url} 이 막혔습니다.`);
  }
});

test("국내 기관은 따로 적지 않아도 이미 통과한다", () => {
  // 한국저작권위원회·공공누리는 .or.kr, e-나라 표준인증은 .go.kr 입니다.
  assert.equal(trustedSourceUrl("https://www.copyright.or.kr/main.do"), true);
  assert.equal(trustedSourceUrl("https://www.kogl.or.kr/info/license.do"), true);
  assert.equal(trustedSourceUrl("https://standard.go.kr/KSCI/standardIntro/getStandardSearchView.do"), true);
});
