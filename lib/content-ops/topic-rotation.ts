import { CONSULTING_TOPIC_FAMILIES } from "./config.ts";

/**
 * 주제를 골고루 돌려 쓰는 규칙. 세 채널이 함께 씁니다.
 *
 * 칼럼에 먼저 붙였다가 여기로 옮겼습니다. 채널마다 따로 두면 한쪽만 조용히
 * 좁아집니다 — 실제로 그래서 홈페이지 칼럼이 몇 달 동안 지원사업 이야기만
 * 썼습니다. 컨설팅에는 있고 칼럼에는 없던 장치가 문제였는데, 이번엔 반대로
 * 칼럼에만 두면 같은 일이 반복됩니다.
 *
 * 그리고 주제군 목록 자체가 화면에만 있었습니다. 15개를 정해 놓고 관리 화면에
 * 보여 주기만 했을 뿐, 글을 만드는 쪽에는 한 번도 넘어가지 않았습니다.
 */

/**
 * 디자인 블로그 주제군.
 *
 * 처음에는 등록된 출처(Material Design, W3C, Nielsen Norman)가 다루는 범위에
 * 맞춰 뽑았습니다. 순서가 거꾸로였습니다. 그래서 「정보 구조·도식화」
 * 「접근성·전달력」 같은 이름이 나왔는데, 아무도 그렇게 검색하지 않습니다.
 *
 * 컨설팅에는 반대 구조가 이미 있습니다(config.ts 의
 * CONSULTING_INFORMATIONAL_TOPIC_TYPES). "4대보험 완납증명서 발급방법" 처럼
 * 입구는 사람들이 실제로 치는 말이고, 깊이는 안에서 공식 자료로 채웁니다.
 *
 * 그래서 결과물 종류로 다시 짰습니다. 울림이 하지 않는 일(로고·CI/BI·패키지)은
 * 뺐습니다 — 글을 읽고 문의해도 받을 수 없으면 서로 시간만 씁니다.
 * 문서 넷을 앞에 둔 것은 그쪽이 본업이기 때문입니다.
 */
export const DESIGN_TOPIC_FAMILIES = [
  // 본업
  "회사소개서·브로슈어",
  "제안서·기획서",
  "IR·투자 자료",
  "발표자료·PPT",
  // 인쇄물
  "리플렛·전단·팸플릿",
  "포스터·배너·현수막",
  "명함·봉투·레터헤드",
  // 디지털
  "상세페이지·웹 포스터",
  "SNS 홍보물·카드뉴스",
  // 규격·실무. 사람들이 실제로 막히는 곳이라 유입이 제일 큽니다.
  "인쇄 규격·재질",
  "파일 입고·색상",
  "폰트·이미지 저작권",
];
/** 채널이 고를 수 있는 주제군. */
export function familiesForChannel(channel: string): readonly string[] {
  return channel === "naver_design" ? DESIGN_TOPIC_FAMILIES : CONSULTING_TOPIC_FAMILIES;
}

/**
 * 최근에 덜 쓴 주제군을 앞에 놓습니다.
 *
 * recentFamilies 는 최신순입니다. 앞에 있을수록 최근에 쓴 것입니다.
 * 목록에 없는 이름(옛 글의 자유 서술 등)은 세지 않습니다. 그것까지 세면
 * 실제로 안 쓴 주제군이 쓴 것으로 잘못 잡힙니다.
 */
export function underusedFamilies(
  recentFamilies: (string | null | undefined)[],
  allFamilies: readonly string[],
  limit = 6,
) {
  const counts = new Map<string, number>(allFamilies.map((family) => [family, 0]));
  const lastSeen = new Map<string, number>();
  recentFamilies.forEach((family, index) => {
    if (!family || !counts.has(family)) return;
    counts.set(family, (counts.get(family) || 0) + 1);
    if (!lastSeen.has(family)) lastSeen.set(family, index);
  });
  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) return left[1] - right[1];
      // 같은 횟수면 더 오래전에 쓴 쪽을 앞에 둡니다.
      return (lastSeen.get(right[0]) ?? Infinity) - (lastSeen.get(left[0]) ?? Infinity);
    })
    .slice(0, Math.max(0, limit))
    .map(([family]) => family);
}

/**
 * 기획 지시문에 넣을 주제군 블록.
 *
 * "고르면 좋겠다"가 아니라 "이 안에서 고른다"로 적습니다. 권고로 적어 두면
 * 공식 자료가 몰려 있는 쪽으로 다시 쏠립니다.
 */
export function topicRotationRules(families: string[]) {
  if (!families.length) return "";
  return `
[우선 주제군 — 최근에 덜 다룬 순서]
${families.map((family, index) => `${index + 1}. ${family}`).join("\n")}
- 후보의 topicFamily 는 위 목록에서 고른다. 다섯 후보의 주제군이 서로 달라야 한다.
- 위쪽 주제군을 먼저 쓴다. 공식 자료가 다른 쪽에 몰려 있어도 그쪽으로 쏠리지 않는다.`;
}
