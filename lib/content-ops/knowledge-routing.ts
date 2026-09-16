import type { ContentChannel, ContentFormat } from "./types";

export type KnowledgeArea =
  | "planning"
  | "design"
  | "government_support"
  | "business_plan"
  | "ir_ppt"
  | "management"
  | "general";

const ALL_AREAS: KnowledgeArea[] = [
  "planning",
  "design",
  "government_support",
  "business_plan",
  "ir_ppt",
  "management",
  "general",
];

const CHANNEL_AREAS: Record<ContentChannel, KnowledgeArea[]> = {
  homepage: ALL_AREAS,
  /*
   * 컨설팅도 홈페이지와 같이 전 분야를 봅니다.
   *
   * 예전에는 design 과 planning 을 뺐습니다. 그런데 기획은 울림의 핵심 분야이고,
   * 컨설팅 글에도 문서·시각화 기획 노하우가 필요합니다. 빼 두면 그 카드들이
   * 홈페이지 칼럼에서만 쓰여 한쪽으로 쏠립니다.
   */
  naver_consulting: ALL_AREAS,
  naver_design: ["design", "ir_ppt", "planning"],
};

export function knowledgeAreasForChannel(channel: ContentChannel) {
  return [...CHANNEL_AREAS[channel]];
}

/**
 * 승인된 원천자료가 반드시 있어야 하는 자리인지 봅니다.
 *
 * 디자인 인사이트형은 예전에 여기 포함돼 있었습니다. 그래서 목요일마다 글을
 * 3,000자 다 써 놓고 마지막 검사에서 "원천자료 미사용" 으로 보류됐습니다.
 * 쓸 만한 디자인 카드가 없으면 몇 번을 돌려도 같은 자리에서 걸렸습니다.
 *
 * 지금은 뺐습니다. 컨설팅 정보형과 같은 길(softVoiceRules)을 탑니다 —
 * 공식 자료를 조사해 쓰고, 맞는 원천자료가 있으면 본문에 한두 번 섞고,
 * 없으면 넣지 않고 넘어갑니다.
 *
 * 울림 콘텐츠형(authority)과 홈페이지 하이브리드 칼럼은 그대로 둡니다.
 * 그 둘은 울림의 판단이 글의 중심이라, 원천자료가 없으면 쓸 내용 자체가
 * 없습니다. 보류되는 것이 맞습니다.
 */
export function knowledgeRequiredForSlot(slot: {
  channel: ContentChannel;
  format: ContentFormat;
}) {
  if (slot.format === "authority") return true;
  return slot.channel === "homepage" && slot.format === "column";
}

export function knowledgeFormatLabel(slot: {
  channel: ContentChannel;
  format: ContentFormat;
}) {
  if (slot.channel === "naver_design") return "디자인 인사이트형";
  if (slot.channel === "homepage" && slot.format === "column") return "하이브리드 칼럼";
  return "울림 콘텐츠형";
}

function normalizedTerms(value: string) {
  return value.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [];
}

export function mostRelevantKnowledgeId(
  plan: {
    topicFamily: string;
    primaryTopic: string;
    angle: string;
    workingTitle: string;
    keyEntities: string[];
  },
  knowledge: Array<{ id: string; topic: string; raw_text: string }>,
) {
  if (!knowledge.length) return null;
  const planTerms = new Set(normalizedTerms([
    plan.topicFamily,
    plan.primaryTopic,
    plan.angle,
    plan.workingTitle,
    ...plan.keyEntities,
  ].join(" ")));
  return [...knowledge]
    .map((item, index) => {
      const itemTerms = new Set(normalizedTerms(`${item.topic} ${item.raw_text.slice(0, 1200)}`));
      const score = [...planTerms].filter((term) => itemTerms.has(term)).length;
      return { id: item.id, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.id || null;
}
