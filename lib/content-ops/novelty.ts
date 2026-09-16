import type { GeneratedContent } from "./generated-content";

export type ContentPlan = {
  topicFamily: string;
  primaryTopic: string;
  angle: string;
  audience: string;
  keyEntities: string[];
  workingTitle: string;
  rationale: string;
  knowledgeIds: string[];
};

export function contentPlanForRevision(plan: ContentPlan): ContentPlan {
  return {
    ...plan,
    angle: "사용자의 최신 수정 요청에 따라 기존 글 보완",
    rationale: "기존 글의 주제와 승인 원천자료를 유지하면서 사용자의 최신 수정 요청을 반영합니다.",
  };
}

export type ContentFingerprint = {
  title: string;
  summary: string;
  headings: string[];
  bodyText: string;
  tags: string[];
  sourceHosts: string[];
  topicFamily: string;
  primaryTopic: string;
  angle: string;
  keyEntities: string[];
};

export type ComparableContent = {
  id: string;
  title: string;
  format: string;
  createdAt?: string | null;
  fingerprint: ContentFingerprint;
};

export type NoveltyMatch = {
  id: string;
  title: string;
  format: string;
  score: number;
  reasons: string[];
};

export type NoveltyAssessment = {
  duplicate: boolean;
  riskScore: number;
  threshold: number;
  matches: NoveltyMatch[];
};

const STOP_WORDS = new Set([
  "그리고", "그러나", "대한", "위한", "통한", "있는", "하는", "해야", "하면", "에서",
  "으로", "에게", "까지", "관련", "기반", "활용", "방법", "전략", "핵심", "가이드", "안내",
  "기업", "중소기업", "스타트업", "지원", "사업", "정부", "정부지원사업", "울림컴퍼니",
  "2026년", "2026년도", "실무", "우리", "소개", "종합", "정리", "필요", "확인",
]);

const DOMAIN_ENTITIES = [
  "이차보전", "정책자금", "스타트업 원스톱 지원센터", "원스톱 지원센터", "기술탈취",
  "기술 탈취", "1357", "수출", "판로", "규제 해소", "모두의 창업", "DX", "AX",
  "기업부설연구소", "연구개발전담부서", "ISO", "HACCP", "녹색인증", "품질인증",
  "해외인증", "법인설립", "사업계획서", "IR", "입찰", "조달", "R&D", "지식재산",
  "PPT", "파워포인트", "정보 구조", "레이아웃", "가독성", "시각화", "디자인 시스템",
];

function plainText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headingsFromHtml(value: string) {
  return [...value.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
    .map((match) => plainText(match[1]))
    .filter(Boolean);
}

function tokens(value: string) {
  return (plainText(value).toLowerCase().match(/[가-힣a-z0-9]+/g) || [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenCosine(left: string, right: string) {
  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (const token of tokens(left)) leftCounts.set(token, (leftCounts.get(token) || 0) + 1);
  for (const token of tokens(right)) rightCounts.set(token, (rightCounts.get(token) || 0) + 1);
  if (!leftCounts.size || !rightCounts.size) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const value of leftCounts.values()) leftMagnitude += value ** 2;
  for (const value of rightCounts.values()) rightMagnitude += value ** 2;
  for (const [token, value] of leftCounts) dot += value * (rightCounts.get(token) || 0);
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function normalizedSet(values: string[]) {
  return new Set(values.flatMap((value) => tokens(value)));
}

function setOverlap(left: string[], right: string[]) {
  const leftSet = normalizedSet(left);
  const rightSet = normalizedSet(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return intersection / Math.min(leftSet.size, rightSet.size);
}

function jaccard(left: string[], right: string[]) {
  const leftSet = new Set(left.map((value) => value.toLowerCase()));
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 지역 이름과 지역 기관 이름.
 *
 * 같은 주제를 지역만 바꿔 반복 생성하는 문제를 막기 위해, 중복 검사를 하기 전에
 * 이 단어들을 지웁니다. "부산테크노파크 시제품 제작지원"과
 * "울산창조경제혁신센터 시제품 제작 지원"이 같은 글로 인식되게 하려는 목적입니다.
 *
 * 지우는 것은 비교할 때뿐이며, 실제 원고에는 그대로 남습니다.
 */
const REGION_NAMES = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충청북도", "충남", "충청남도",
  "전북", "전라북도", "전남", "전라남도", "경북", "경상북도", "경남", "경상남도", "제주",
  "창원", "김해", "양산", "진주", "거제", "통영", "포항", "구미", "천안", "청주",
  "전주", "여수", "순천", "수원", "성남", "용인", "고양", "화성", "이천", "하남", "평택",
];

const REGION_ORG_SUFFIXES = [
  "테크노파크", "창조경제혁신센터", "지방중소벤처기업청", "중소벤처기업청",
  "경제진흥원", "산업진흥원", "신용보증재단", "테크노밸리", "창업보육센터",
  "상공회의소", "발전연구원", "일자리재단", "도시공사", "관광공사",
];

const REGION_PATTERN = new RegExp(
  `(${REGION_NAMES.join("|")})\\s*(특별시|광역시|특별자치시|특별자치도|시|도|군|구)?\\s*(${REGION_ORG_SUFFIXES.join("|")})?`,
  "g",
);

/** 비교용으로만 지역 표현을 지웁니다. */
export function stripRegionTokens(value: string) {
  if (!value) return "";
  return value
    .replace(REGION_PATTERN, " ")
    .replace(new RegExp(`(${REGION_ORG_SUFFIXES.join("|")})`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 지역 표현을 지운 뒤 남는 핵심 주제. 이것이 같으면 지역만 바꾼 글로 봅니다. */
export function coreTopicKey(fingerprint: { topicFamily: string; primaryTopic: string }) {
  return stripRegionTokens(`${fingerprint.topicFamily} ${fingerprint.primaryTopic}`)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .trim();
}

function inferredEntities(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  return DOMAIN_ENTITIES.filter((entity) => normalized.includes(entity.toLowerCase()));
}

export function fingerprintFromGenerated({
  generated,
  plan,
}: {
  generated: GeneratedContent;
  plan?: ContentPlan | null;
}): ContentFingerprint {
  const headings = headingsFromHtml(generated.bodyHtml || "");
  const combined = [
    generated.title,
    generated.summary,
    headings.join(" "),
    generated.bodyHtml,
    generated.tags.join(" "),
  ].join(" ");
  return {
    title: generated.title || "",
    summary: generated.summary || "",
    headings,
    bodyText: plainText(generated.bodyHtml || ""),
    tags: generated.tags || [],
    sourceHosts: [...new Set((generated.sourceUrls || []).map(sourceHost).filter(Boolean))],
    topicFamily: plan?.topicFamily || "",
    primaryTopic: plan?.primaryTopic || "",
    angle: plan?.angle || "",
    // 지역 이름을 지운 상태로 비교해야 지역만 바꾼 반복을 잡을 수 있습니다.
    keyEntities: [...new Set([
      ...(plan?.keyEntities || []).map(stripRegionTokens).filter(Boolean),
      ...inferredEntities(combined),
    ])],
  };
}

export function fingerprintFromPlan(plan: ContentPlan): ContentFingerprint {
  return {
    title: plan.workingTitle,
    summary: plan.rationale,
    headings: [],
    bodyText: `${plan.primaryTopic} ${plan.angle} ${plan.rationale}`,
    tags: [],
    sourceHosts: [],
    topicFamily: plan.topicFamily,
    primaryTopic: plan.primaryTopic,
    angle: plan.angle,
    keyEntities: [...new Set([
      ...plan.keyEntities.map(stripRegionTokens).filter(Boolean),
      ...inferredEntities(`${plan.workingTitle} ${plan.primaryTopic} ${plan.angle} ${plan.rationale}`),
    ])],
  };
}

/**
 * 출처 구성을 중복 근거에서 뺄 수 있게 합니다.
 *
 * 홈페이지 칼럼은 같은 공고를 근거로 다른 관점의 글을 여러 편 씁니다.
 * 그건 중복이 아닙니다. 블로그는 지금처럼 출처 구성도 함께 봅니다.
 */
type CompareOptions = { ignoreSources?: boolean };

function compareFingerprints(
  candidate: ContentFingerprint,
  existing: ContentFingerprint,
  stage: "plan" | "article",
  options: CompareOptions = {},
) {
  // 지역 이름을 지운 상태로 비교합니다.
  // 지우지 않으면 "부산~"과 "울산~"이 서로 다른 글처럼 보여 중복을 통과합니다.
  const candidateCore = coreTopicKey(candidate);
  const existingCore = coreTopicKey(existing);
  const sameCoreTopic = Boolean(candidateCore) && candidateCore === existingCore;
  const topicSimilarity = Math.max(
    tokenCosine(
      stripRegionTokens(`${candidate.topicFamily} ${candidate.primaryTopic} ${candidate.angle} ${candidate.title}`),
      stripRegionTokens(`${existing.topicFamily} ${existing.primaryTopic} ${existing.angle} ${existing.title}`),
    ),
    candidate.topicFamily && existing.topicFamily && candidate.topicFamily === existing.topicFamily ? 0.75 : 0,
    sameCoreTopic ? 0.95 : 0,
  );
  const structureSimilarity = setOverlap(
    [candidate.title, candidate.summary, ...candidate.headings],
    [existing.title, existing.summary, ...existing.headings],
  );
  const bodySimilarity = tokenCosine(
    stripRegionTokens(`${candidate.title} ${candidate.summary} ${candidate.bodyText}`),
    stripRegionTokens(`${existing.title} ${existing.summary} ${existing.bodyText}`),
  );
  const entitySimilarity = setOverlap(candidate.keyEntities, existing.keyEntities);
  const sourceSimilarity = options.ignoreSources
    ? 0
    : jaccard(candidate.sourceHosts, existing.sourceHosts);
  /*
   * 출처를 빼면 가중치 합이 0.9 가 되어 점수가 통째로 낮아집니다.
   * 그러면 같은 문턱값(58점)이 사실상 느슨해집니다. 쓴 가중치로 나눠
   * 눈금을 그대로 맞춥니다.
   */
  const weights = stage === "plan"
    ? [[topicSimilarity, 0.42], [structureSimilarity, 0.23],
      [bodySimilarity, 0.15], [entitySimilarity, 0.20]]
    : [[topicSimilarity, 0.22], [structureSimilarity, 0.20],
      [bodySimilarity, 0.25], [entitySimilarity, 0.23],
      ...(options.ignoreSources ? [] : [[sourceSimilarity, 0.10]])];
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const weighted = weights.reduce((sum, [value, weight]) => sum + value * weight, 0)
    / (totalWeight || 1);
  const score = Math.round(weighted * 100);
  const duplicate = stage === "plan"
    // 지역을 지운 핵심 주제가 완전히 같으면 표현이 달라도 중복으로 봅니다.
    ? sameCoreTopic || score >= 48 || (topicSimilarity >= 0.68 && entitySimilarity >= 0.42)
    : sameCoreTopic
      || score >= 58
      || (!options.ignoreSources
        && entitySimilarity >= 0.5 && bodySimilarity >= 0.34 && sourceSimilarity >= 0.6)
      || (topicSimilarity >= 0.78 && structureSimilarity >= 0.45);
  const reasons = [
    ...(sameCoreTopic ? ["지역 표현을 빼면 같은 주제임"] : []),
    ...(topicSimilarity >= 0.55 ? ["핵심 주제와 관점이 유사함"] : []),
    ...(structureSimilarity >= 0.4 ? ["제목·목차 구조가 유사함"] : []),
    ...(bodySimilarity >= 0.34 ? ["본문에서 다루는 내용이 유사함"] : []),
    ...(entitySimilarity >= 0.45 ? ["같은 제도·사업·핵심어를 반복함"] : []),
    ...(sourceSimilarity >= 0.75 ? ["사용한 공식 출처 구성이 거의 같음"] : []),
  ];
  return { score, duplicate, reasons };
}

export function assessNovelty({
  candidate,
  existing,
  stage = "article",
  ignoreSources = false,
}: {
  candidate: ContentFingerprint;
  existing: ComparableContent[];
  stage?: "plan" | "article";
  /** 같은 출처를 다시 쓰는 것을 중복으로 보지 않습니다. 칼럼이 씁니다. */
  ignoreSources?: boolean;
}): NoveltyAssessment {
  const matches = existing
    .map((item) => {
      const comparison = compareFingerprints(candidate, item.fingerprint, stage, { ignoreSources });
      return {
        id: item.id,
        title: item.title,
        format: item.format,
        score: comparison.score,
        reasons: comparison.reasons,
        duplicate: comparison.duplicate,
      };
    })
    .sort((left, right) => right.score - left.score);
  const strongest = matches[0];
  return {
    duplicate: Boolean(strongest?.duplicate),
    riskScore: strongest?.score || 0,
    threshold: stage === "plan" ? 48 : 58,
    matches: matches.slice(0, 3).map((match) => ({
      id: match.id,
      title: match.title,
      format: match.format,
      score: match.score,
      reasons: match.reasons,
    })),
  };
}

export function comparableFromStoredItem(item: {
  id: string;
  title: string;
  summary?: string | null;
  format: string;
  source_reference?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}): ComparableContent | null {
  const metadata = (item.metadata || {}) as {
    generated?: GeneratedContent;
    novelty?: { plan?: ContentPlan };
  };
  if (!metadata.generated?.bodyHtml) return null;
  let sourceUrls = metadata.generated.sourceUrls || [];
  if (!sourceUrls.length && item.source_reference) {
    try {
      const parsed = JSON.parse(item.source_reference);
      if (Array.isArray(parsed)) sourceUrls = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      sourceUrls = [];
    }
  }
  return {
    id: item.id,
    title: item.title,
    format: item.format,
    createdAt: item.created_at,
    fingerprint: fingerprintFromGenerated({
      generated: {
        ...metadata.generated,
        title: metadata.generated.title || item.title,
        summary: metadata.generated.summary || item.summary || "",
        sourceUrls,
      },
      plan: metadata.novelty?.plan,
    }),
  };
}
