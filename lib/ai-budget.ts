/**
 * 원고 생성 단계의 낭비 상한 — 단일 관리 지점.
 *
 * 역할 구분
 * - lib/gemini/protection.ts : 호출을 할지 말지 결정하는 차단·예산 장치
 * - lib/ai-budget.ts (이 파일) : 호출이 허용됐을 때 한 번에 얼마나 쓸지 정하는 낭비 상한
 *
 * 보호 모드에서 원고 생성을 다시 켜는 순간 아래 값이 실제 요금을 결정합니다.
 *
 * 비용에 영향을 주는 순서
 *   1) 호출 횟수  (가장 큼. Google 검색 연동은 호출당 과금)
 *   2) 입력 토큰  (프롬프트에 싣는 자료의 양)
 *   3) 출력 상한  (실제 생성분만 과금되므로 폭주 방지용 안전장치)
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 호출 횟수 — 비용의 1순위 */
export const AI_ATTEMPTS = {
  /** 새 글을 만들 때 시도할 주제 후보 수. 이전 3 → 2 */
  articlePlans: envInt("AI_MAX_ARTICLE_ATTEMPTS", 2),
  /** 생성 결과가 기준 미달일 때 보정 시도 횟수 */
  articleRepair: envInt("AI_MAX_ARTICLE_REPAIR", 2),
  /** JSON 파싱 실패 시 같은 프롬프트 재요청 횟수 */
  jsonReparse: envInt("AI_MAX_JSON_REPARSE", 2),
} as const;

/** 입력 크기 — 비용의 2순위 (글자 수 기준) */
export const AI_INPUT_LIMITS = {
  knowledgeRawText: envInt("AI_LIMIT_KNOWLEDGE_CHARS", 2000),
  sourceSnapshot: envInt("AI_LIMIT_SNAPSHOT_CHARS", 1200),
  researchSnapshot: envInt("AI_LIMIT_RESEARCH_SNAPSHOT_CHARS", 1500),
  recentArticles: envInt("AI_LIMIT_RECENT_ARTICLES", 20),
} as const;

/** 출력 상한 — 폭주 방지용 안전장치 */
export const AI_OUTPUT_LIMITS = {
  // 이 모델은 답을 쓰기 전에 생각하는 데도 출력 한도를 씁니다.
  // 4000 으로 줄였더니 생각에 다 쓰고 JSON 이 잘려 나와 매번 보류가 났습니다.
  // 원래 값인 6000 으로 되돌립니다.
  topicPlan: envInt("AI_OUT_TOPIC_PLAN", 6000),
  articleBody: envInt("AI_OUT_ARTICLE_BODY", 12000),
  columnBody: envInt("AI_OUT_COLUMN_BODY", 14000),
  // 말투 다듬기는 소제목 한 구간씩 맡깁니다. 답이 짧아 잘릴 일이 거의 없습니다.
  // 원고를 통째로 넘기던 시절에는 12000 에서도 JSON 이 끝을 맺지 못하고 잘렸습니다.
  styleRevisionSection: envInt("AI_OUT_STYLE_SECTION", 6000),
  // 요약과 FAQ 는 본문보다 훨씬 짧습니다.
  styleRevisionHead: envInt("AI_OUT_STYLE_HEAD", 4000),
} as const;

/** 한 번의 관리자 클릭이 처리할 최대 건수 — 밀린 물량 일괄 소진 방지 */
export const AI_BATCH_LIMITS = {
  /** 문체 일괄 수정 1회 실행당 최대 건수 (이전: 무제한) */
  styleRevisionPerRun: envInt("AI_LIMIT_STYLE_REVISION_ITEMS", 12),
} as const;

/**
 * 저장해 둔 공식자료 조사 결과를 다시 쓸 수 있는 기간(시간).
 * 이 기간 안에 같은 주제를 수정하면 Google 검색 조사를 다시 실행하지 않습니다.
 * 조사는 호출당 과금이라 수정 1건당 요금 차이가 가장 큰 항목입니다.
 */
export const RESEARCH_REUSE_HOURS = envInt("AI_RESEARCH_REUSE_HOURS", 72);

/**
 * 칼럼 본문 최소 분량(공백 제외 한글 가시문자).
 * 이 값에 미달하면 글 전체를 한 번 더 생성하므로 비용이 두 배가 됩니다.
 * 목표가 3,500자이므로 재생성 기준은 그보다 낮게 둡니다. 이전 3000 → 2600
 */
/**
 * 칼럼 본문 하한.
 *
 * 블로그는 2,000자인데 칼럼만 2,600자였습니다. 다를 이유가 없어 맞췄습니다.
 * 이 값에 못 미치면 글 전체를 한 번 더 만들므로 요금이 두 배가 됩니다.
 */
export const COLUMN_MIN_BODY_CHARS = envInt("AI_COLUMN_MIN_BODY_CHARS", 2000);
