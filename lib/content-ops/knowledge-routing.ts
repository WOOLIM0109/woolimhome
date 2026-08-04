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
  naver_consulting: [
    "management",
    "government_support",
    "business_plan",
    "ir_ppt",
    "general",
  ],
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
