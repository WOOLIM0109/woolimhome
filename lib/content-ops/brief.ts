// 테스트가 이 파일을 그대로 실행합니다. @/ 별칭은 실행 시점에 풀리지 않아
// 여기서는 상대 경로로 씁니다. 같은 폴더의 다른 규칙 파일들과 같은 방식입니다.
import { trustedSourceUrl } from "../research/trusted-sources.ts";

/**
 * 사람이 건네는 주문서.
 *
 * 블로그 초안을 만드는 길이 "알아서 아무 주제나 골라 줘" 하나뿐이었습니다.
 * 쓰고 싶은 주제가 있어도 넣을 자리가 없어서, 나온 글을 통째로 갈아 끼우거나
 * 원하는 주제가 뽑힐 때까지 다시 돌리는 수밖에 없었습니다.
 *
 * 세 가지를 받습니다. 셋 다 선택입니다.
 * - 주제 한 줄: 한 단어여도 됩니다. 여기서부터 주제 후보를 만듭니다.
 * - 참고 자료: 이미 써 둔 원고나 공고문을 통째로 붙여넣는 자리입니다.
 * - 참고 링크: 공식 원문 주소입니다. 실제로 읽어 조사 재료에 넣습니다.
 *
 * 붙이는 것이 많을수록 결과가 정확해지고, 하나도 없으면 지금까지와 똑같이
 * 알아서 주제를 고릅니다.
 */
export type ContentBrief = {
  topicHint: string;
  sourceMaterial: string;
  sourceUrls: string[];
};

export const BRIEF_LIMITS = {
  /** 주제 한 줄. 문장 몇 개까지는 받습니다. */
  topicHint: 400,
  /** 붙여넣는 참고 자료. 칼럼 한 편이 보통 4,000자 안팎입니다. */
  sourceMaterial: 12_000,
  /** 읽어 볼 참고 링크 수. 칼럼 쪽과 같은 값입니다. */
  sourceUrls: 8,
} as const;

function trimmed(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * 요청 본문에서 주문서를 꺼냅니다.
 *
 * 셋 다 비어 있으면 null 을 돌려줍니다. 부르는 쪽은 그때 지금까지와 똑같이
 * 알아서 주제를 고르는 길로 갑니다.
 */
export function parseContentBrief(body: unknown): ContentBrief | null {
  const source = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const topicHint = trimmed(source.topicHint, BRIEF_LIMITS.topicHint);
  const sourceMaterial = trimmed(source.sourceMaterial, BRIEF_LIMITS.sourceMaterial);
  const sourceUrls = Array.isArray(source.sourceUrls)
    ? [...new Set(source.sourceUrls
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter(Boolean))].slice(0, BRIEF_LIMITS.sourceUrls)
    : [];
  if (!topicHint && !sourceMaterial && !sourceUrls.length) return null;
  return { topicHint, sourceMaterial, sourceUrls };
}

/**
 * 건네받은 링크 중 실제로 읽을 것과, 읽지 않고 돌려보낼 것을 나눕니다.
 *
 * 걸러진 주소는 조용히 버리지 않고 돌려줍니다.
 * 붙였는데 아무 일도 일어나지 않으면 왜 반영이 안 됐는지 알 길이 없습니다.
 */
export function splitBriefSourceUrls(brief: ContentBrief | null) {
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const url of brief?.sourceUrls || []) {
    if (trustedSourceUrl(url)) allowed.push(url);
    else rejected.push(url);
  }
  return { allowed, rejected };
}

/** 주제 후보를 뽑을 때 붙이는 지시. */
export function briefPlanningRules(brief: ContentBrief | null) {
  if (!brief) return "";
  const parts = ["\n[대표가 지정한 주문]"];
  if (brief.topicHint) parts.push(`주제: ${brief.topicHint}`);
  if (brief.sourceMaterial) {
    parts.push(`참고 자료(주제를 잡는 데만 씁니다):\n${brief.sourceMaterial}`);
  }
  parts.push(
    "- 후보 5개를 모두 이 주문 안에서 만든다. 다른 주제로 넘어가지 않는다.",
    "- 독자, 풀려는 문제, 판단 기준을 달리해서 서로 다른 각도로 나눈다.",
    "- 최근 글과 소재가 겹치더라도 지정된 주제를 유지하고, 각도를 다르게 잡아 차별화한다.",
  );
  if (brief.sourceMaterial) {
    parts.push("- 참고 자료의 목차를 그대로 베끼지 않는다. 이 채널 독자에게 맞는 순서로 다시 짠다.");
  }
  return parts.join("\n");
}

/** 본문을 쓸 때 붙이는 지시. */
export function briefWritingRules(brief: ContentBrief | null) {
  if (!brief) return "";
  const parts = ["\n[대표가 지정한 주문]"];
  if (brief.topicHint) parts.push(`주제: ${brief.topicHint}`);
  if (brief.sourceMaterial) {
    parts.push(`참고 자료:\n${brief.sourceMaterial}`);
    parts.push(
      "- 참고 자료는 주제와 논지를 잡는 데 씁니다. 문장을 그대로 옮겨 쓰지 않습니다.",
      // 붙여넣은 자료를 근거로 인정해 버리면 사실 확인 절차가 통째로 무력해집니다.
      // 자료는 무엇을 조사할지 알려 주는 역할까지만 합니다.
      "- 참고 자료에 나오는 제도명, 금액, 기간, 대상, 자격, 통계, 기관명은 그 자체로 근거가 되지 않습니다.",
      "- 개별 조사 결과에서 [공식 확인 완료]로 확인된 값만 본문에 씁니다.",
      "  참고 자료에는 있지만 확인되지 않은 값은 흐리게 쓰지 말고 본문에서 완전히 뺍니다.",
      "- 참고 자료의 목차를 그대로 따라가지 말고, 결론이 먼저 오도록 다시 짭니다.",
    );
  }
  return parts.join("\n");
}
