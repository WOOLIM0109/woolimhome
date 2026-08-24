/**
 * 대표님이 올린 파일을 노하우 카드로 나눕니다.
 *
 * 예전에는 이 기능이 "비용 보호 모드에서 차단됩니다"라는 말만 돌려주었습니다.
 * 무엇을 확인해서 막은 것이 아니라, 조건 없이 늘 막는 껍데기였습니다.
 * 예산 관문은 이미 다른 기능이 다 쓰고 있으므로, 그 관문을 그대로 통과시키고
 * 실제로 동작하게 합니다.
 */

/** 카드 하나에 들어가는 것. column_expert_knowledge 표와 같은 모양입니다. */
export type KnowledgeCard = {
  topic: string;
  source_type: "interview" | "case" | "note";
  expertise_area: "planning" | "design" | "government_support" | "business_plan"
  | "ir_ppt" | "management" | "general";
  raw_text: string;
  perspective: string | null;
  case_evidence: string | null;
  differentiator: string | null;
};

const SOURCE_TYPES = ["interview", "case", "note"] as const;
const EXPERTISE_AREAS = [
  "planning", "design", "government_support", "business_plan",
  "ir_ppt", "management", "general",
] as const;

/** 한 번에 만들 수 있는 카드 수. 파일 하나로 표를 뒤덮지 않게 합니다. */
export const MAX_CARDS_PER_FILE = 30;

/** AI 에 넘길 글자 수. 넘치면 요금만 오르고 뒷부분은 어차피 잘립니다. */
export const MAX_IMPORT_CHARS = 40_000;

/** 받아 줄 파일 크기. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export const KNOWLEDGE_CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    cards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          source_type: { type: "STRING", enum: [...SOURCE_TYPES] },
          expertise_area: { type: "STRING", enum: [...EXPERTISE_AREAS] },
          raw_text: { type: "STRING" },
          perspective: { type: "STRING" },
          case_evidence: { type: "STRING" },
          differentiator: { type: "STRING" },
        },
        required: ["topic", "source_type", "expertise_area", "raw_text"],
      },
    },
  },
  required: ["cards"],
} as const;

function optional(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

/**
 * AI 응답을 카드로 바꿉니다.
 *
 * 목록에 없는 분류를 그대로 저장하면 표의 제약에 걸려, 파일을 다 읽고 요금까지
 * 쓴 뒤 마지막 저장에서 통째로 거절당합니다. 칼럼 쪽에서 그렇게 한 번 죽었습니다.
 * 그래서 모르는 값은 버리지 않고 안전한 기본값으로 낮춥니다.
 */
export function parseKnowledgeCards(raw: string): KnowledgeCard[] {
  const text = String(raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("분류 결과 JSON을 찾지 못했습니다.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { cards?: unknown };
  if (!Array.isArray(parsed.cards)) throw new Error("분류 결과에 카드가 없습니다.");

  return parsed.cards
    .map((entry): KnowledgeCard | null => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const topic = typeof item.topic === "string" ? item.topic.trim() : "";
      const rawText = typeof item.raw_text === "string" ? item.raw_text.trim() : "";
      // 주제와 내용이 없는 카드는 사람이 손볼 것도 없습니다.
      if (!topic || !rawText) return null;
      const sourceType = SOURCE_TYPES.find((value) => value === item.source_type) || "note";
      const area = EXPERTISE_AREAS.find((value) => value === item.expertise_area) || "general";
      return {
        topic,
        source_type: sourceType,
        expertise_area: area,
        raw_text: rawText,
        perspective: optional(item.perspective),
        case_evidence: optional(item.case_evidence),
        differentiator: optional(item.differentiator),
      };
    })
    .filter((card): card is KnowledgeCard => Boolean(card))
    .slice(0, MAX_CARDS_PER_FILE);
}

/** 어떤 파일을 읽을 수 있는지. */
export function importableKind(fileName: string, mimeType = "") {
  const name = fileName.toLowerCase();
  if (name.endsWith(".docx")) return "docx" as const;
  if (/\.(txt|md|markdown|csv)$/.test(name)) return "text" as const;
  if (mimeType.startsWith("text/")) return "text" as const;
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx" as const;
  }
  return null;
}

export function knowledgeImportPrompt(text: string) {
  return `[노하우 카드 분류]
아래는 울림컴퍼니 대표가 쓴 글입니다. 인터뷰 기록일 수도, 상담 사례일 수도, 메모일 수도 있습니다.
이 글을 칼럼에 쓸 수 있는 "노하우 카드" 여러 장으로 나눕니다.

지킬 것:
- 한 카드는 한 가지 이야기만 담는다. 여러 주제가 섞이면 카드를 나눈다.
- **글에 없는 내용을 지어내지 않는다.** 요약하고 정리할 뿐이다.
  해당 항목이 글에 없으면 그 칸은 비운다. 그럴듯하게 채우지 않는다.
- raw_text 에는 원문의 표현을 최대한 살린다. 대표의 말투가 칼럼의 재료다.
- perspective 는 대표가 어떻게 판단하는지, case_evidence 는 실제 사례,
  differentiator 는 남들과 다르게 보는 지점이다.
- source_type: 대화·문답이면 interview, 특정 기업 사례면 case, 그 밖은 note.
- expertise_area: planning(기획) / design(디자인) / government_support(정부지원)
  / business_plan(사업계획서) / ir_ppt(IR·PPT) / management(경영) / general(그 외)
- 카드는 최대 ${MAX_CARDS_PER_FILE}장.

[글]
${text.slice(0, MAX_IMPORT_CHARS)}

JSON 객체 하나만 반환한다.`;
}
