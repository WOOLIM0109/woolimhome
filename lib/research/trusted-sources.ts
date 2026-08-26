/**
 * 사람이 직접 건네준 참고 링크를 받아들일지 판단합니다.
 *
 * 조사 결과에 링크를 하나 끼워 넣으면 그 내용이 사실 근거로 쓰입니다.
 * 그래서 아무 주소나 받지 않고, 정부·공공기관·학교·공식 통계처럼
 * 원문을 확인할 수 있는 곳만 통과시킵니다.
 *
 * 칼럼 쪽에서만 쓰던 규칙인데, 블로그도 같은 길을 쓰게 되면서 여기로 옮겼습니다.
 * 두 곳이 서로 다른 기준을 갖게 되면 한쪽만 조용히 느슨해집니다.
 */
export const TRUSTED_SOURCE_SUFFIXES = [
  // 정부·공공기관·학교·공식 통계
  ".go.kr", ".or.kr", ".ac.kr", "law.go.kr", "k-startup.go.kr", "bizinfo.go.kr",
  "kostat.go.kr", "kosis.kr", "doi.org", "oecd.org", "worldbank.org",

  /*
   * 언론사.
   *
   * 예전에는 정부·공공기관 주소만 읽었습니다. 그래서 헤럴드경제나 뉴스1 같은
   * 기사는 참고자료로 달 수 없었고, 대표가 직접 쓴 칼럼의 출처조차 이 기준을
   * 넘지 못했습니다.
   *
   * 더 큰 문제는 주제였습니다. 읽을 수 있는 자료가 지원사업·정책자금 쪽에만
   * 있으니 나오는 글도 그 주제뿐이었습니다. 마케팅이나 재무 같은 주제는
   * 이름만 걸려 있고 실제로 글이 나올 통로가 없었습니다.
   *
   * 등급은 나누지 않습니다. 목록에 있으면 그냥 쓸 수 있는 출처입니다.
   * 개인 블로그와 광고성 글은 목록에 없으므로 지금처럼 계속 막힙니다.
   */
  // 통신사
  "yna.co.kr", "news1.kr", "newsis.com", "yonhapnewstv.co.kr",
  // 경제지
  "mk.co.kr", "hankyung.com", "sedaily.com", "edaily.co.kr", "fnnews.com",
  "heraldcorp.com", "ajunews.com", "mt.co.kr", "asiae.co.kr", "etnews.com",
  "biz.chosun.com", "bizwatch.co.kr", "thebell.co.kr",
  // 종합일간지
  "chosun.com", "joongang.co.kr", "donga.com", "hani.co.kr", "khan.co.kr",
  "hankookilbo.com", "segye.com", "kmib.co.kr", "seoul.co.kr", "munhwa.com",
  // 방송
  "kbs.co.kr", "imbc.com", "sbs.co.kr", "ytn.co.kr", "jtbc.co.kr", "mbn.co.kr",

  /*
   * 디자인·문서 표준을 내는 곳.
   *
   * 디자인 블로그 주제(인쇄 규격, 색, 폰트 저작권, 문서 형식)는 한국 정부
   * 사이트에 없는 것이 많습니다. 도련이 몇 mm 인지, 별색을 어떻게 지정하는지는
   * 이런 곳이 원문입니다. 없으면 조사 단계에서 근거를 못 찾아 글이 보류되고,
   * 그게 지금 목요일 글이 걸리던 자리였습니다.
   *
   * 국내 기관은 따로 적지 않습니다. 한국저작권위원회·공공누리는 .or.kr,
   * e-나라 표준인증은 .go.kr 이라 위에서 이미 통과합니다.
   */
  "adobe.com", "microsoft.com", "pantone.com", "w3.org", "material.io", "nngroup.com",
];

/**
 * 같은 문서를 가리키는 주소를 같은 모습으로 만듭니다.
 *
 * 예전에는 AI 가 쓴 출처 주소를 글자 하나까지 똑같은 것만 인정했습니다.
 * 뒤에 슬래시가 하나 붙거나 추적용 꼬리표가 달리면 없는 출처로 쳤습니다.
 * 그래서 출처를 네 개 제대로 달아도 셋이 표기 차이로 날아가 "출처 2개 미만"
 * 으로 보류되는 일이 있었습니다.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|ref$|referrer$|from$)/i;

export function sameSourceUrl(left: string, right: string) {
  const a = normalizedSourceUrl(left);
  const b = normalizedSourceUrl(right);
  return Boolean(a) && a === b;
}

export function normalizedSourceUrl(input: string) {
  try {
    const url = new URL(String(input || "").trim());
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    // 끝의 슬래시는 같은 문서를 가리킵니다.
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * 같은 곳에서 나온 주소인지 봅니다.
 *
 * 주소가 글자 하나까지 같아야 인정하던 자리가 아직 남아 있었습니다
 * (lib/content-ops/generate.ts). 그래서 조사가 찾아온 진짜 근거
 *
 *     law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000222488
 *
 * 가 목록의 law.go.kr 과 안 맞아 버려졌고, 글에는 대문 주소만 실렸습니다.
 * 독자는 근거 페이지로 갈 수 없었습니다. 모델은 그걸 배워 아예 대문만 답니다.
 *
 * 같은 기관이면 어느 페이지든 같은 곳으로 봅니다. www 유무와 http/https 는
 * 무시합니다.
 */
export function sameHost(left: string, right: string) {
  const host = (value: string) => {
    try {
      return new URL(String(value || "").trim()).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const a = host(left);
  return Boolean(a) && a === host(right);
}

export function trustedSourceUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return TRUSTED_SOURCE_SUFFIXES.some((suffix) => (
      host === suffix.replace(/^\./, "") || host.endsWith(suffix)
    ));
  } catch {
    return false;
  }
}
