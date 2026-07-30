export type GeneratedContent = {
  title: string;
  summary: string;
  bodyHtml: string;
  faq: { question: string; answer: string }[];
  tags: string[];
  sourceUrls: string[];
  usedKnowledgeIds: string[];
};

export const GENERATED_CONTENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    summary: { type: "STRING" },
    bodyHtml: { type: "STRING" },
    faq: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          answer: { type: "STRING" },
        },
        required: ["question", "answer"],
      },
    },
    tags: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    sourceUrls: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    usedKnowledgeIds: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["title", "summary", "bodyHtml", "faq", "tags", "sourceUrls", "usedKnowledgeIds"],
} as const;

function extractJsonObject(value: string) {
  const withoutFence = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("JSON 객체를 찾지 못했습니다.");
  }
  return withoutFence.slice(start, end + 1);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseGeneratedContent(raw: string): GeneratedContent {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<GeneratedContent>;
  if (
    typeof parsed.title !== "string"
    || typeof parsed.summary !== "string"
    || typeof parsed.bodyHtml !== "string"
    || !Array.isArray(parsed.faq)
    || !parsed.faq.every((item) =>
      item
      && typeof item === "object"
      && typeof item.question === "string"
      && typeof item.answer === "string")
    || !stringArray(parsed.tags)
    || !stringArray(parsed.sourceUrls)
    || !stringArray(parsed.usedKnowledgeIds)
  ) {
    throw new Error("필수 콘텐츠 필드가 누락되었습니다.");
  }
  return parsed as GeneratedContent;
}

const TECHNICAL_HOLD_PATTERNS = [
  /^Expected\s/i,
  /^Unexpected\s/i,
  /\bJSON\b.*(?:position|line|column|문법|형식)/i,
  /^AI (?:생성 요청|응답)/,
  /^자동 (?:생성|검증) 보류/,
  /^자동 재생성 보류/,
  /^(?:중복 검사|원천자료 확인) 보류:/,
  /^GENERATION_/,
];

export function editorialRevisionNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note || TECHNICAL_HOLD_PATTERNS.some((pattern) => pattern.test(note))) return null;
  return note.slice(0, 4000);
}

type RevisionMetadata = Record<string, unknown> & {
  generated?: Partial<GeneratedContent>;
  novelty?: {
    plan?: {
      knowledgeIds?: unknown;
    };
  };
  pendingRevision?: {
    note?: unknown;
    requestedAt?: unknown;
  };
};

export function pendingRevisionNote(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  return editorialRevisionNote((metadata as RevisionMetadata).pendingRevision?.note);
}

export function resolveRevisionNote(
  requestedNote: unknown,
  currentReviewNote: unknown,
  metadata: unknown,
) {
  if (requestedNote !== undefined) return editorialRevisionNote(requestedNote);
  return editorialRevisionNote(currentReviewNote) || pendingRevisionNote(metadata);
}

export function revisionKnowledgeIds(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return [];
  const stored = metadata as RevisionMetadata;
  const generatedIds = Array.isArray(stored.generated?.usedKnowledgeIds)
    ? stored.generated.usedKnowledgeIds
    : [];
  const planIds = Array.isArray(stored.novelty?.plan?.knowledgeIds)
    ? stored.novelty.plan.knowledgeIds
    : [];
  return [...new Set([...generatedIds, ...planIds].filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  ))];
}

export function metadataAfterSuccessfulRevision(metadata: unknown) {
  const next = metadata && typeof metadata === "object"
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  delete next.pendingRevision;
  return next;
}
