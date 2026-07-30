import type { ContentPlan } from "./novelty";

export const TOPIC_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topicFamily: { type: "STRING" },
          primaryTopic: { type: "STRING" },
          angle: { type: "STRING" },
          audience: { type: "STRING" },
          keyEntities: { type: "ARRAY", items: { type: "STRING" } },
          workingTitle: { type: "STRING" },
          rationale: { type: "STRING" },
          knowledgeIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: [
          "topicFamily", "primaryTopic", "angle", "audience", "keyEntities",
          "workingTitle", "rationale", "knowledgeIds",
        ],
      },
    },
  },
  required: ["candidates"],
} as const;

function extractJsonObject(value: string) {
  const withoutFence = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("주제 후보 JSON 객체를 찾지 못했습니다.");
  return withoutFence.slice(start, end + 1);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseTopicPlans(raw: string): ContentPlan[] {
  const parsed = JSON.parse(extractJsonObject(raw)) as { candidates?: Partial<ContentPlan>[] };
  if (!Array.isArray(parsed.candidates)) throw new Error("주제 후보가 없습니다.");
  return parsed.candidates.filter((candidate): candidate is ContentPlan =>
    typeof candidate.topicFamily === "string"
    && typeof candidate.primaryTopic === "string"
    && typeof candidate.angle === "string"
    && typeof candidate.audience === "string"
    && strings(candidate.keyEntities)
    && typeof candidate.workingTitle === "string"
    && typeof candidate.rationale === "string"
    && strings(candidate.knowledgeIds))
    .slice(0, 5);
}
