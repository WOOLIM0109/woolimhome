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
  ".go.kr", ".or.kr", ".ac.kr", "law.go.kr", "k-startup.go.kr", "bizinfo.go.kr",
  "kostat.go.kr", "kosis.kr", "doi.org", "oecd.org", "worldbank.org",
];

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
