import { COLUMN_KINDS } from "./types.ts";

/**
 * AI 에게 넘기는 응답 설계도.
 *
 * 이게 없어서 화·목·토마다 칼럼이 사라졌습니다.
 *
 *     Expected ',' or '}' after property value in JSON at position 3640
 *
 * 설계도를 주지 않으면 모델이 자유 형식으로 JSON 을 씁니다. 그러면 본문에
 * 큰따옴표가 들어가는 순간 문자열이 거기서 끊깁니다.
 *
 *     "bodyHtml": "<p>대표님이 "무형의 서비스"라고 하셨습니다.</p>"
 *                              ↑ 값이 끝난 것으로 읽힘 → 다음 글자에서 오류
 *
 * 잘린 것이 아니라 두 동강 난 것이라, 잘림을 보는 assertComplete 도
 * 제어문자를 고치는 escapeJsonStringControlCharacters 도 살리지 못합니다.
 * 재시도까지 같은 자리에서 깨지면 조사에 쓴 요금까지 함께 버려집니다.
 *
 * 설계도를 주면 모델이 문법을 지킨 JSON 을 돌려줍니다. 블로그 본문
 * (lib/content-ops/generated-content.ts)과 칼럼 주제 기획에는 있었고
 * 칼럼 본문 한 군데만 빠져 있었습니다.
 *
 * required 를 넓게 잡지 않는 이유가 있습니다. 항목을 많이 요구하면 모델이
 * 채우지 못했을 때 응답 자체가 거절당하고, 그러면 지금과 똑같이 그 회차를
 * 잃습니다. 없으면 글이 성립하지 않는 것만 넣고, 나머지 빈자리는
 * normalizeDraft 가 빈 값으로 채웁니다.
 */

const STRING_LIST = { type: "ARRAY", items: { type: "STRING" } } as const;

const FAQ_LIST = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      question: { type: "STRING" },
      answer: { type: "STRING" },
    },
    required: ["question", "answer"],
  },
} as const;

/**
 * 칼럼 초안 한 편의 모양. lib/columns/generate.ts 의 Generated 타입과 짝입니다.
 * 한쪽만 바뀌면 draft-schema.test.mjs 가 실패합니다.
 */
export const COLUMN_DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    slug: { type: "STRING" },
    excerpt: { type: "STRING" },
    category: { type: "STRING" },
    // 표의 제약에 없는 값을 저장하면 마지막 줄에서 통째로 거절당합니다(#129).
    // normalizeDraft 가 뒤에서 한 번 더 낮춰 주지만, 애초에 못 쓰게 막습니다.
    contentKind: { type: "STRING", enum: [...COLUMN_KINDS] },
    audience: { type: "STRING" },
    coreMessage: { type: "STRING" },
    tags: STRING_LIST,
    bodyHtml: { type: "STRING" },
    faqs: FAQ_LIST,
    usedSourceUrls: STRING_LIST,
    usedKnowledgeIds: STRING_LIST,
    expertQuestions: STRING_LIST,
  },
  required: ["title", "bodyHtml"],
} as const;

/**
 * 고쳐 쓴 조각만 돌려받을 때 쓰는 설계도.
 *
 * 글 전체를 다시 받으면 그만큼 응답이 길어지고 끊길 위험도 같이 커집니다.
 * 바뀌는 곳만 받습니다.
 */
export const COLUMN_BODY_PATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    bodyHtml: { type: "STRING" },
    faqs: FAQ_LIST,
  },
  required: ["bodyHtml"],
} as const;
