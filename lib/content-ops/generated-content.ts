export type GeneratedContent = {
  title: string;
  summary: string;
  bodyHtml: string;
  faq: { question: string; answer: string }[];
  tags: string[];
  sourceUrls: string[];
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
  },
  required: ["title", "summary", "bodyHtml", "faq", "tags", "sourceUrls"],
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
  /^GENERATION_/,
];

export function editorialRevisionNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note || TECHNICAL_HOLD_PATTERNS.some((pattern) => pattern.test(note))) return null;
  return note.slice(0, 4000);
}
