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

export function knowledgeRequiredForSlot(slot: {
  channel: ContentChannel;
  format: ContentFormat;
}) {
  if (slot.format === "authority") return true;
  if (slot.channel === "homepage" && slot.format === "column") return true;
  return slot.channel === "naver_design" && slot.format === "design_insight";
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
