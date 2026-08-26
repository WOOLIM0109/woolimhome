import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";
import { generateGeminiText } from "@/lib/gemini/client";
import { stripVerificationControlText } from "@/lib/columns/verification";
import { researchOfficialFacts } from "@/lib/research/official";
import { briefPlanningRules, briefWritingRules, splitBriefSourceUrls, type ContentBrief } from "./brief";
import { assertStageFits, deadlineExceeded } from "./deadline";
import { AI_ATTEMPTS, AI_INPUT_LIMITS, AI_OUTPUT_LIMITS, RESEARCH_REUSE_HOURS } from "@/lib/ai-budget";
import { CONSULTING_INFORMATIONAL_TOPIC_TYPES } from "./config";
import { PORTFOLIO_WRITING_RULES } from "./portfolio-rules";
import { FRIENDLY_EDITORIAL_STYLE_RULES } from "./editorial-style";
import { editorialPublicationIssues } from "./editorial-policy";
import { insertSentenceBreaks } from "./sentence-breaks-html";
import type { EditorialSlot } from "./types";
import {
  generationCancellationRequested,
  removeCancelledGeneration,
} from "./cancellation";
import {
  metadataAfterSuccessfulRevision,
  resolveRevisionNote,
  revisionKnowledgeIds,
  GENERATED_CONTENT_SCHEMA,
  parseGeneratedContent,
  type GeneratedContent,
} from "./generated-content";
import {
  assessNovelty,
  comparableFromStoredItem,
  contentPlanForRevision,
  fingerprintFromGenerated,
  fingerprintFromPlan,
  type ComparableContent,
  type ContentPlan,
  type NoveltyAssessment,
} from "./novelty";
import {
  familiesForChannel,
  topicRotationRules,
  underusedFamilies,
} from "./topic-rotation";
import {
  parseTopicPlans,
  TOPIC_PLAN_SCHEMA,
} from "./topic-planning";
import {
  knowledgeAreasForChannel,
  knowledgeFormatLabel,
  knowledgeRequiredForSlot,
  mostRelevantKnowledgeId,
} from "./knowledge-routing";
import { createStyleRevisionStamp } from "./style-revision-rules";
import {
  KNOWLEDGE_POOL_LIMIT,
  selectRotatingKnowledge,
} from "@/lib/columns/knowledge-rotation";

/** 블로그 글 한 편에 넘기는 노하우 카드 수. */
const KNOWLEDGE_PER_BLOG_POST = 8;

type Source = {
  name: string;
  base_url: string;
  source_grade: number;
  topic_families: string[];
  channels: string[];
};

type AvailableSource = Source & { snapshot: string };

type ExpertKnowledge = {
  id: string;
  topic: string;
  raw_text: string;
  perspective: string | null;
  case_evidence: string | null;
  differentiator: string | null;
  expertise_area: string;
  use_count: number;
};

type StoredWorkItem = {
  id: string;
  title: string;
  summary: string | null;
  format: string;
  source_reference: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

const MAX_ARTICLE_ATTEMPTS = AI_ATTEMPTS.articlePlans;
const NOVELTY_LOOKBACK_DAYS = 90;
const AI_RESPONSE_TIMEOUT_MS = 90_000;

/**
 * 공식자료 조사 결과. 문구 수정처럼 주제가 그대로인 재작성에서 다시 사용합니다.
 * 조사에는 Google 검색 연동이 붙어 호출당 과금되므로, 재사용 여부가 수정 1건의 요금을 좌우합니다.
 */
type StoredResearch = {
  dossier: string;
  sources: { title: string; url: string }[];
  topicKey?: string;
  savedAt?: string;
};

function isStoredResearch(value: unknown): value is StoredResearch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredResearch>;
  return typeof candidate.dossier === "string"
    && candidate.dossier.length > 0
    && Array.isArray(candidate.sources)
    && candidate.sources.every((source) => typeof source?.title === "string" && typeof source?.url === "string");
}

/**
 * 지난번 조사 결과를 다시 쓸 수 있는지 판단합니다.
 * 새 주제를 뽑는 경우에는 재사용하지 않습니다. 조사 내용이 주제와 어긋나기 때문입니다.
 */
function reusableStoredResearch(
  storedMetadata: Record<string, unknown>,
  options: { isRevision: boolean; now?: Date },
): StoredResearch | null {
  if (!options.isRevision) return null;
  const stored = storedMetadata.research;
  if (!isStoredResearch(stored) || !stored.topicKey || !stored.savedAt) return null;
  const savedAt = Date.parse(stored.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const ageHours = ((options.now?.getTime() ?? Date.now()) - savedAt) / 3_600_000;
  if (ageHours < 0 || ageHours > RESEARCH_REUSE_HOURS) return null;
  return stored;
}

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sourceSnapshot(source: Source) {
  try {
    const response = await fetch(source.base_url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    return { ...source, snapshot: clean(await response.text()).slice(0, 5000) };
  } catch {
    return null;
  }
}

function knowledgeForWriting(item: ExpertKnowledge): ExpertKnowledge {
  return {
    ...item,
    raw_text: stripVerificationControlText(item.raw_text),
    perspective: stripVerificationControlText(item.perspective),
    case_evidence: stripVerificationControlText(item.case_evidence),
    differentiator: stripVerificationControlText(item.differentiator),
  };
}

function mergeAvailableSources(sources: AvailableSource[]) {
  return [...new Map(sources.map((source) => [source.base_url, source])).values()];
}

function promptFor(
  slot: EditorialSlot,
  sources: unknown[],
  plan: ContentPlan,
  knowledge: ExpertKnowledge[],
  researchDossier: string,
  revision?: { note: string; previous?: GeneratedContent },
  brief?: ContentBrief | null,
) {
  const requiresKnowledge = knowledgeRequiredForSlot(slot);
  const designRules = slot.channel === "naver_design" ? `
이 글은 디자인 블로그 전용이다. 주제는 PPT·PDF·비즈니스 문서 기획, 정보 구조, 레이아웃, 가독성, 시각화, 디자인 시스템 중에서만 고른다.
정부지원사업·정책자금·기업인증·대출·지원금은 제목과 중심 주제로 사용할 수 없다.
울림이 실제로 수행하지 않은 프로젝트·성과·고객 반응을 만들지 않는다.
포트폴리오 사례처럼 쓰지 말고, 공식 디자인 자료를 실무자가 적용할 수 있도록 해설하는 기획·디자인 인사이트로 작성한다.
제목에 채널명이나 [naver_design] 같은 내부 표기를 넣지 않는다.` : "";
  const channel = slot.channel === "naver_design" ? "PPT·PDF·디자인·비즈니스 문서" : "종합 경영컨설팅";
  const formatRules = requiresKnowledge ? `
이 글은 ${knowledgeFormatLabel(slot)}이다. 승인된 울림 원천자료가 글의 중심이어야 한다.
공식 자료는 울림의 판단을 뒷받침하는 사실 근거로만 사용하고, 여러 지원사업을 모은 종합 안내문으로 바꾸지 않는다.
usedKnowledgeIds에는 실제로 활용한 원천자료 id를 최소 1개 넣는다.
원천자료에 없는 경험·성과·의견은 만들지 않는다.
대표가 무엇을 먼저 보고 무엇을 버리는지, 왜 그렇게 판단하는지, 독자가 어떻게 적용하는지가 드러나야 한다.` : `
이 글은 정보형 또는 디자인 인사이트형이다. 한 가지 구체적인 고객 문제에 집중한다.
여러 제도·사업을 한꺼번에 나열한 종합 안내문을 만들지 않는다.
공식 출처는 실제로 본문에 사용한 2~4개만 sourceUrls에 넣는다.
sourceUrls는 원고 하단의 출처 섹션으로 자동 표시되므로, 본문에 사용한 공개 공식 URL을 최소 2개 정확히 넣는다.`;
  const revisionRules = revision ? `
이 작업은 기존 초안의 수정 요청을 반영하는 재작성이다.
수정 요청: ${revision.note}
${revision.previous ? `기존 초안:\n${JSON.stringify(revision.previous)}` : ""}
수정 요청을 빠짐없이 반영하되, 출처에 없는 사실이나 성과를 새로 만들지 말고 전체 JSON 초안을 완성해서 반환한다.` : "";
  return `당신은 울림컴퍼니의 ${channel} 콘텐츠 편집자입니다.

채널: ${slot.channel}
형식: ${slot.format}
${designRules}
${slot.format === "portfolio" ? PORTFOLIO_WRITING_RULES : ""}
${formatRules}
${revisionRules}
${briefWritingRules(brief ?? null)}
${FRIENDLY_EDITORIAL_STYLE_RULES}

선정된 주제 기획:
${JSON.stringify(plan)}

아래 공식 출처와 개별 조사 결과만 근거로 한국 기업 담당자가 이해하기 쉬운 초안을 작성하세요. 출처에 없는 숫자·요건·사례를 만들지 마세요. 전문 용어는 처음 나올 때 쉬운 설명을 붙이세요.

[사실조사 적용 규칙]
- 제도명, 금액, 기간, 대상, 자격, 지원 조건, 통계, 법령, 기술 기준은 각각 별도의 주장으로 보고 개별 조사 결과와 대조합니다.
- 지원사업·정책자금을 다루는 글이라면 금액, 마감일, 자격 요건을 반드시 본문에 적습니다.
  읽는 사람이 가장 먼저 찾는 정보입니다. 조사 결과에 있으면 빠뜨리지 않습니다.
  언론 기사에서 확인된 것도 씁니다. 다만 같은 내용을 담은 공고 원문이 있으면 원문 쪽 숫자를 먼저 씁니다.
- [공식 확인 완료]에 포함된 사실만 본문에 사용하고 해당 공식 URL을 sourceUrls에 넣습니다.
- [공식자료 미확인 · 본문 제외] 항목은 표현을 흐리거나 '확인 필요'라고 사용자에게 넘기지 말고 본문에서 완전히 제외합니다.
- [외부 조사 불가 · 대표 확인 필요] 항목은 공개 동의가 확인된 승인 원천자료가 아니면 본문에 쓰지 않습니다.
- 새 공개 사실이 필요하면 임의로 보충하지 말고 제공된 조사 결과의 범위 안에서 설명합니다.

반드시 JSON만 반환하세요:
{"title":"","summary":"","bodyHtml":"<h2>...</h2><p>...</p>","faq":[{"question":"","answer":""}],"tags":[""],"sourceUrls":[""],"usedKnowledgeIds":[""]}

조건: 본문은 공백 제외 약 3,500자를 목표로 충분히 설명하고, 어떤 경우에도 2,000자 미만으로 줄이지 마세요. H2 3개 이상, FAQ 3개. HTML은 h2,h3,p,ul,ol,li,strong,blockquote,a만 사용하세요. FAQ 질문은 실제 고객의 말투로 작성하세요.

승인된 울림 원천자료:
${knowledge.length ? JSON.stringify(knowledge) : "없음"}

개별 공식 조사 결과:
${researchDossier}

출처:
${JSON.stringify(sources)}`;
}

function recentContentSummary(existing: ComparableContent[]) {
  return existing.slice(0, AI_INPUT_LIMITS.recentArticles).map((item) => ({
    id: item.id,
    title: item.title,
    format: item.format,
    topicFamily: item.fingerprint.topicFamily,
    primaryTopic: item.fingerprint.primaryTopic,
    angle: item.fingerprint.angle,
    keyEntities: item.fingerprint.keyEntities,
    headings: item.fingerprint.headings,
    sourceHosts: item.fingerprint.sourceHosts,
  }));
}

async function requestTopicPlans({
  slot,
  sources,
  knowledge,
  existing,
  scheduleKey,
  brief,
}: {
  slot: EditorialSlot;
  sources: (Source & { snapshot: string })[];
  knowledge: ExpertKnowledge[];
  existing: ComparableContent[];
  scheduleKey: string;
  brief?: ContentBrief | null;
}) {
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    throw new Error("GENERATION_CANCELLED");
  }
  const requiresKnowledge = knowledgeRequiredForSlot(slot);
  const authorityRules = requiresKnowledge ? `
- 반드시 승인된 울림 원천자료 중 하나를 중심으로 삼고 knowledgeIds에 해당 id를 넣는다.
- 공식 지원사업을 모아 소개하는 종합 안내 주제는 금지한다.
- 울림의 판단 순서, 선택 기준, 실제 맥락이 중심이 되는 후보만 만든다.` : `
- 공식 자료에서 한 가지 구체적인 고객 문제를 고른다.
- 여러 지원사업·제도·기능을 한 글에 모은 종합 안내 주제는 금지한다.
- knowledgeIds는 빈 배열로 반환한다.`;
  /**
   * 컨설팅 정보형 주제가 지원사업·정책자금으로만 쏠리는 것을 막습니다.
   *
   * 공식 출처가 그쪽에 몰려 있어 후보 5개가 매번 비슷하게 나왔습니다.
   * 실제 블로그에서 검색 유입이 꾸준한 서류·시스템·용어 정리 글을 함께 만들게 합니다.
   */
  const informationalVarietyRules = slot.channel === "naver_consulting"
    && slot.format === "informational"
    // 주제를 지정받았을 때는 유형을 골고루 섞으라는 규칙을 끕니다.
    // 이 규칙에는 '지원사업 안내는 5개 중 1개까지' 같은 조건이 들어 있어서,
    // 지정한 주제가 거기 걸리면 후보가 엉뚱한 쪽으로 밀려납니다.
    && !brief
    ? `
- 후보 5개 중 최소 3개는 아래 유형에서 서로 다른 유형으로 고른다. 같은 유형을 두 개 이상 넣지 않는다.
- '지원사업·정책자금 안내' 유형은 5개 중 최대 1개까지만 허용한다.
- 아래 예시는 결을 보여 주는 참고일 뿐이다. 제목을 베끼지 말고 아직 다루지 않은 다른 서류·시스템·절차를 고른다.
- 담당자가 실제로 검색하는 말(발급 방법, 유효기간, 차이, 준비서류, 오류 해결)이 주제에 드러나게 한다.
${JSON.stringify(CONSULTING_INFORMATIONAL_TOPIC_TYPES)}`
    : "";
  const designRules = slot.channel === "naver_design" ? `
- 디자인 채널 후보는 PPT·PDF·비즈니스 문서의 기획, 정보 구조, 레이아웃, 가독성, 시각화에만 한정한다.
- 정부지원사업·정책자금·기업인증은 후보로 만들지 않는다.` : "";

  /**
   * 최근에 덜 다룬 주제군을 먼저 고르게 합니다.
   *
   * 주제군 목록은 지금까지 관리 화면에만 있었고, 기획에는 한 번도 넘어가지
   * 않았습니다. 그래서 겹치지만 않으면 어느 쪽으로 쏠려도 막을 것이 없었습니다.
   * 주제를 지정받았을 때(brief)는 끕니다. 사람이 정한 주제를 밀어내면 안 됩니다.
   */
  const rotationRules = brief ? "" : topicRotationRules(underusedFamilies(
    existing.map((item) => item.fingerprint.topicFamily),
    familiesForChannel(slot.channel),
    6,
  ));
  const prompt = `당신은 울림컴퍼니의 콘텐츠 편집장이다.
본문을 쓰기 전에 서로 충분히 다른 주제 후보 5개를 기획한다.

채널: ${slot.channel}
글 유형: ${slot.format}
${authorityRules}
${informationalVarietyRules}
${designRules}
${rotationRules}
${briefPlanningRules(brief ?? null)}

[최근 90일 같은 채널 콘텐츠 — 주제·제도·관점·목차가 겹치면 안 됨]
${JSON.stringify(recentContentSummary(existing))}

[승인된 울림 원천자료]
${knowledge.length ? JSON.stringify(knowledge.map((item) => ({
    id: item.id,
    topic: item.topic,
    perspective: item.perspective,
    caseEvidence: item.case_evidence,
    differentiator: item.differentiator,
    expertiseArea: item.expertise_area,
    rawText: item.raw_text.slice(0, AI_INPUT_LIMITS.knowledgeRawText),
  }))) : "없음"}

[사용 가능한 공식 출처]
${JSON.stringify(sources.map((source) => ({
    name: source.name,
    url: source.base_url,
    topicFamilies: source.topic_families,
    snapshot: source.snapshot.slice(0, AI_INPUT_LIMITS.sourceSnapshot),
  })))}

후보마다 대주제, 구체 주제, 기존 글과 다른 관점, 한 명의 독자, 핵심 제도·사업·개념, 가제, 차별화 이유를 적는다.
JSON 객체만 반환한다.`;
  let lastFormatError: unknown;
  for (let attempt = 0; attempt < AI_ATTEMPTS.jsonReparse; attempt += 1) {
    if (await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      throw new Error("GENERATION_CANCELLED");
    }
    const retryInstruction = attempt
      ? "\n\n이전 주제 후보 응답은 JSON 문법 오류로 읽지 못했습니다. 후보를 처음부터 다시 만들고 JSON 객체 외에는 아무 글자도 반환하지 마세요."
      : "";
    const { text: raw, finishReason } = await generateGeminiText({
      parts: [{ text: `${prompt}${retryInstruction}` }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: TOPIC_PLAN_SCHEMA,
        // 한도에 걸려 잘렸다면 같은 한도로 다시 부르는 것은 돈만 쓰고 또 실패합니다.
        maxOutputTokens: AI_OUTPUT_LIMITS.topicPlan * (attempt + 1),
      },
      timeoutMs: AI_RESPONSE_TIMEOUT_MS,
    });
    try {
      if (finishReason === "MAX_TOKENS") {
        throw new Error(
          "주제 후보를 다 쓰기 전에 출력 한도에 걸렸습니다. "
          + "환경변수 AI_OUT_TOPIC_PLAN 값을 올리면 해결됩니다.",
        );
      }
      if (!raw) throw new Error("주제 기획 응답이 비어 있습니다.");
      const plans = parseTopicPlans(raw);
      if (!plans.length) throw new Error("사용할 수 있는 주제 후보를 만들지 못했습니다.");
      return plans;
    } catch (error) {
      lastFormatError = error;
    }
  }
  const detail = lastFormatError instanceof Error
    ? lastFormatError.message
    : "알 수 없는 JSON 형식 오류";
  throw new Error(`주제 기획 응답 형식을 두 번 복구하지 못했습니다: ${detail}`);
}

async function requestGeneratedContent({
  prompt,
  scheduleKey,
}: {
  prompt: string;
  scheduleKey: string;
}) {
  let lastParseError: unknown;
  for (let attempt = 0; attempt < AI_ATTEMPTS.jsonReparse; attempt += 1) {
    if (await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      throw new Error("GENERATION_CANCELLED");
    }
    const retryInstruction = attempt
      ? "\n\n이전 응답은 JSON 문법 오류로 읽지 못했습니다. 내용을 처음부터 다시 생성하고, JSON 객체 외에는 아무 글자도 반환하지 마세요."
      : "";
    const { text: raw, finishReason } = await generateGeminiText({
      parts: [{ text: `${prompt}${retryInstruction}` }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GENERATED_CONTENT_SCHEMA,
        // 한도에 걸려 잘렸다면 두 번째에는 여유를 더 줍니다.
        maxOutputTokens: AI_OUTPUT_LIMITS.articleBody * (attempt + 1),
      },
      timeoutMs: AI_RESPONSE_TIMEOUT_MS,
    });
    if (!raw) throw new Error("AI 응답이 비어 있습니다.");
    try {
      if (finishReason === "MAX_TOKENS") {
        throw new Error(
          "본문을 다 쓰기 전에 출력 한도에 걸렸습니다. "
          + "환경변수 AI_OUT_ARTICLE_BODY 값을 올리면 해결됩니다.",
        );
      }
      return parseGeneratedContent(raw);
    } catch (error) {
      lastParseError = error;
    }
  }
  const detail = lastParseError instanceof Error ? lastParseError.message : "알 수 없는 JSON 형식 오류";
  throw new Error(`AI 응답 형식을 두 번 복구하지 못했습니다: ${detail}`);
}

export async function generateContentWorkItem(
  slot: EditorialSlot,
  scheduleKey: string,
  options: {
    revisionNote?: string | null;
    forceNewTopic?: boolean;
    /** 사람이 건넨 주문서. 없으면 지금까지처럼 알아서 주제를 고릅니다. */
    brief?: ContentBrief | null;
    /**
     * 이 시각까지만 씁니다(Date.now() 기준 밀리초).
     * 남은 시간이 한 단계를 끝낼 만큼 없으면 시작하지 않고 멈춥니다.
     * 돈을 쓰고 죽는 것보다 쓰지 않고 미루는 편이 낫습니다.
     */
    deadlineAt?: number | null;
  } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const brief = options.brief || null;
  const deadlineAt = options.deadlineAt || null;
  if (slot.channel === "naver_design" && slot.format === "portfolio") {
    throw new Error("포트폴리오형은 실제 프로젝트 원본과 완성 이미지가 연결된 뒤에만 생성합니다.");
  }

  const admin = createAdminClient();
  const { data: currentWorkItem, error: workItemError } = await admin
    .from("content_work_items")
    .select("id,title,summary,format,source_reference,created_at,review_note,metadata")
    .eq("schedule_key", scheduleKey)
    .maybeSingle();
  if (workItemError) throw new Error(workItemError.message);
  const storedMetadata = (currentWorkItem?.metadata || {}) as Record<string, unknown> & {
    generated?: GeneratedContent;
  };
  const revisionNote = resolveRevisionNote(
    options.revisionNote,
    currentWorkItem?.review_note,
    storedMetadata,
  );
  const pinnedKnowledgeIds = revisionNote && !options.forceNewTopic
    ? revisionKnowledgeIds(storedMetadata)
    : [];
  const requiresKnowledge = knowledgeRequiredForSlot(slot);
  const allowedKnowledgeAreas = knowledgeAreasForChannel(slot.channel);
  const lookbackAt = new Date(Date.now() - (NOVELTY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  const [
    { data: registered, error: sourceError },
    { data: recentItems, error: recentError },
    knowledgeResult,
  ] = await Promise.all([
    admin.from("content_source_registry")
      .select("name,base_url,source_grade,topic_families,channels")
      .eq("enabled", true).contains("channels", [slot.channel]).order("source_grade").limit(8),
    admin.from("content_work_items")
      .select("id,title,summary,format,source_reference,created_at,metadata")
      .eq("channel", slot.channel)
      .neq("schedule_key", scheduleKey)
      .gte("created_at", lookbackAt)
      .order("created_at", { ascending: false })
      .limit(40),
    requiresKnowledge
      ? admin.from("column_expert_knowledge")
        .select("id,topic,raw_text,perspective,case_evidence,differentiator,expertise_area,use_count,created_at")
        .eq("approved", true)
        .in("expertise_area", allowedKnowledgeAreas)
        .order("use_count", { ascending: true })
        .order("created_at", { ascending: false })
        // 넉넉히 읽고, 어떤 여덟 장을 쓸지는 아래에서 분야를 번갈아 고릅니다.
        .limit(KNOWLEDGE_POOL_LIMIT)
      : Promise.resolve({ data: [] as ExpertKnowledge[], error: null }),
  ]);
  if (sourceError) throw new Error(sourceError.message);
  if (recentError) throw new Error(recentError.message);
  if (knowledgeResult.error) throw new Error(knowledgeResult.error.message);
  /*
   * 전문 분야를 번갈아 가며 여덟 장을 고릅니다.
   *
   * 예전에는 덜 쓴 순서로 여덟 장을 그냥 잘랐습니다. 그러면 한 분야 카드가
   * 여덟 자리를 통째로 차지할 수 있어, 그 분야만 소진되고 나머지는 잠듭니다.
   * 칼럼이 쓰던 규칙을 그대로 가져다 씁니다. 채널마다 따로 두면 한쪽만
   * 조용히 좁아집니다.
   */
  let knowledge = selectRotatingKnowledge(
    (knowledgeResult.data || []) as ExpertKnowledge[],
    KNOWLEDGE_PER_BLOG_POST,
  );
  if (requiresKnowledge && pinnedKnowledgeIds.length) {
    const { data: pinnedKnowledge, error: pinnedKnowledgeError } = await admin
      .from("column_expert_knowledge")
      .select("id,topic,raw_text,perspective,case_evidence,differentiator,expertise_area,use_count,created_at")
      .eq("approved", true)
      .in("expertise_area", allowedKnowledgeAreas)
      .in("id", pinnedKnowledgeIds);
    if (pinnedKnowledgeError) throw new Error(pinnedKnowledgeError.message);
    const byId = new Map<string, ExpertKnowledge>();
    for (const item of [...(pinnedKnowledge || []), ...knowledge] as ExpertKnowledge[]) {
      byId.set(item.id, item);
    }
    knowledge = [...byId.values()];
  }
  knowledge = knowledge.map(knowledgeForWriting);
  if (requiresKnowledge && !knowledge.length) {
    throw new Error(`${knowledgeFormatLabel(slot)}에 필요한 승인된 인터뷰·노하우 원천자료가 없습니다.`);
  }
  const registeredSources = (await Promise.all((registered || []).map(sourceSnapshot)))
    .filter((source): source is Source & { snapshot: string } => Boolean(source));
  // 대표가 붙인 링크를 실제로 읽어 조사 재료에 넣습니다.
  // 등록 출처만으로는 새로 뜬 공고처럼 아직 목록에 없는 자료를 다룰 수 없습니다.
  const { allowed: allowedBriefUrls, rejected: rejectedBriefUrls } = splitBriefSourceUrls(brief);
  const briefSources = (await Promise.all(allowedBriefUrls.map((url) => sourceSnapshot({
    name: (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
    })(),
    base_url: url,
    source_grade: 1,
    topic_families: [],
    channels: [slot.channel],
  }))))
    .filter((source): source is Source & { snapshot: string } => Boolean(source));
  // 주소는 통과했는데 그 페이지를 못 읽은 경우도 알려 줍니다.
  // 링크를 붙였는데 아무 일도 일어나지 않으면 왜 반영이 안 됐는지 알 길이 없습니다.
  const readBriefUrls = new Set(briefSources.map((source) => source.base_url));
  const unreadableBriefUrls = allowedBriefUrls.filter((url) => !readBriefUrls.has(url));
  const sources = mergeAvailableSources([...briefSources, ...registeredSources]);
  if (sources.length < 2) throw new Error("읽을 수 있는 채널 전용 공식 출처가 2개 미만입니다.");

  const existing = (recentItems || [])
    .filter((item) => !(slot.format === "design_insight" && item.format === "portfolio"))
    .map((item) => comparableFromStoredItem(item as StoredWorkItem))
    .filter((item): item is ComparableContent => Boolean(item));
  if (options.forceNewTopic && currentWorkItem?.id && storedMetadata.generated) {
    existing.unshift({
      id: currentWorkItem.id,
      title: currentWorkItem.title,
      format: currentWorkItem.format,
      createdAt: currentWorkItem.created_at,
      fingerprint: fingerprintFromGenerated({
        generated: storedMetadata.generated,
        plan: (storedMetadata.novelty as { plan?: ContentPlan } | undefined)?.plan,
      }),
    });
  }

  const previousPlan = (storedMetadata.novelty as { plan?: ContentPlan } | undefined)?.plan;
  const fallbackPlan: ContentPlan | null = storedMetadata.generated ? {
    topicFamily: slot.channel === "naver_design" ? "기획·디자인" : "종합 경영컨설팅",
    primaryTopic: storedMetadata.generated.title,
    angle: revisionNote || "기존 초안의 관점 유지",
    audience: "한국 기업 실무자",
    keyEntities: storedMetadata.generated.tags || [],
    workingTitle: storedMetadata.generated.title,
    rationale: "기존 초안의 수정 요청을 반영합니다.",
    knowledgeIds: storedMetadata.generated.usedKnowledgeIds || [],
  } : null;
  const priorRevisionPlan = previousPlan || fallbackPlan;
  // 주제를 새로 뽑아야 하는 경우에만 시간을 봅니다.
  // 수정 재작성은 기존 기획을 그대로 쓰므로 AI 를 부르지 않습니다.
  if (!(revisionNote && !options.forceNewTopic && priorRevisionPlan)) {
    assertStageFits("topicPlan", deadlineAt);
  }
  const requestedPlans = revisionNote && !options.forceNewTopic && priorRevisionPlan
    ? [contentPlanForRevision(priorRevisionPlan)]
    : await requestTopicPlans({ slot, sources, knowledge, existing, scheduleKey, brief });
  const approvedKnowledgeIds = new Set(knowledge.map((item) => item.id));
  const planned = requestedPlans.map((plan) => ({
    plan: {
      ...plan,
      knowledgeIds: (() => {
        const validIds = plan.knowledgeIds.filter((id) => approvedKnowledgeIds.has(id));
        if (validIds.length || !requiresKnowledge || !revisionNote) return validIds;
        const fallbackId = mostRelevantKnowledgeId(plan, knowledge);
        return fallbackId ? [fallbackId] : [];
      })(),
    },
    assessment: assessNovelty({
      candidate: fingerprintFromPlan(plan),
      existing,
      stage: "plan",
    }),
  }));
  // 대표가 주제를 지정했으면 소재가 겹친다고 취소하지 않습니다.
  // 지정한 주제로 써 달라는 요청 자체가 중복을 감수하겠다는 뜻입니다.
  // 대신 얼마나 겹치는지는 아래에서 검토 메모로 남깁니다.
  const skipDuplicateBlock = Boolean(brief) || Boolean(revisionNote && !options.forceNewTopic);
  const eligiblePlans = planned.filter(({ plan, assessment }) =>
    (skipDuplicateBlock || !assessment.duplicate)
    && (!requiresKnowledge || plan.knowledgeIds.length > 0));
  if (!eligiblePlans.length) {
    const strongest = planned
      .flatMap(({ assessment }) => assessment.matches)
      .sort((left, right) => right.score - left.score)[0];
    const missingKnowledge = requiresKnowledge
      && planned.every(({ plan }) => !plan.knowledgeIds.length);
    const message = missingKnowledge
      ? "울림 원천자료를 중심으로 한 차별화 주제 후보가 없습니다."
      : `최근 글과 겹치지 않는 주제 후보가 없습니다.${strongest ? ` 가장 유사한 글: ${strongest.title}` : ""}`;
    const { data, error } = await admin.from("content_work_items").update({
      status: "on_hold",
      retry_count: 0,
      next_retry_at: null,
      last_error_code: null,
      last_error_context: {},
      review_note: `${missingKnowledge ? "원천자료 확인" : "중복 검사"} 보류: ${message}`,
      metadata: {
        ...storedMetadata,
        novelty: {
          stage: "planning",
          duplicate: !missingKnowledge,
          blockedReason: missingKnowledge ? "missing_knowledge" : "duplicate",
          riskScore: strongest?.score || 0,
          threshold: 48,
          matches: strongest ? [strongest] : [],
          checkedAt: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    }).eq("schedule_key", scheduleKey).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  let selected: {
    generated: GeneratedContent;
    plan: ContentPlan;
    novelty: NoveltyAssessment;
    issues: string[];
    plainLength: number;
    h2Count: number;
    faqCount: number;
    usedKnowledgeIds: string[];
    sourcePool: AvailableSource[];
  } | null = null;
  const attempts: {
    title: string;
    riskScore: number;
    duplicate: boolean;
    issues: string[];
  }[] = [];
  // 공식자료 조사는 Google 검색 연동이 붙어 호출당 과금됩니다.
  // (1) 같은 실행 안에서 주제가 겹치면 다시 조사하지 않습니다.
  // (2) 문구 수정처럼 주제가 그대로인 재작성이면 지난번 조사 결과를 그대로 씁니다.
  const researchCache = new Map<string, StoredResearch>();
  const reusableResearch = reusableStoredResearch(storedMetadata, {
    isRevision: Boolean(revisionNote) && !options.forceNewTopic,
  });

  articlePlans:
  for (const { plan } of eligiblePlans.slice(0, MAX_ARTICLE_ATTEMPTS)) {
    const selectedKnowledge = knowledge.filter((item) => plan.knowledgeIds.includes(item.id));
    const researchKey = `${plan.topicFamily}|${plan.primaryTopic}`;
    const cachedResearch = researchCache.get(researchKey)
      ?? (reusableResearch?.topicKey === researchKey ? reusableResearch : null);
    // 이미 조사해 둔 것이 있으면 시간을 보지 않습니다. 부를 일이 없으니까요.
    if (!cachedResearch) assertStageFits("research", deadlineAt);
    const research: StoredResearch = cachedResearch
      ?? await researchOfficialFacts({
        topic: `${plan.workingTitle} — ${plan.primaryTopic}`,
        sourceContext: JSON.stringify({
          plan,
          ...(brief ? {
            // 붙여넣은 자료를 조사 담당에게 그대로 넘깁니다.
            // 여기에 적힌 숫자와 기한이 조사 대상이 되고, 확인된 것만 본문에 남습니다.
            requestedTopic: brief.topicHint || null,
            suppliedMaterial: brief.sourceMaterial || null,
          } : {}),
          woolimKnowledge: selectedKnowledge,
          registeredOfficialSources: sources.map((source) => ({
            name: source.name,
            url: source.base_url,
            snapshot: source.snapshot.slice(0, AI_INPUT_LIMITS.researchSnapshot),
          })),
        }),
      });
    researchCache.set(researchKey, research);
    const researchSources: AvailableSource[] = research.sources.map((source) => ({
      name: source.title,
      base_url: source.url,
      source_grade: 1,
      topic_families: [plan.topicFamily, plan.primaryTopic],
      channels: [slot.channel],
      snapshot: `Google Search 개별 조사에서 확인된 공식 원문: ${source.title}`,
    }));
    const sourcePool = mergeAvailableSources([...sources, ...researchSources]);
    const basePrompt = promptFor(
      slot,
      sourcePool,
      plan,
      selectedKnowledge,
      research.dossier,
      revisionNote && !options.forceNewTopic
        ? { note: revisionNote, previous: storedMetadata.generated }
        : undefined,
      brief,
    );
    let repairInstruction = "";
    for (let repairAttempt = 0; repairAttempt < AI_ATTEMPTS.articleRepair; repairAttempt += 1) {
      // 본문을 시작할 시간이 없으면 여기서 멈춥니다. 이미 고른 후보가 있으면
      // 그것을 저장하고, 없으면 아무것도 쓰지 않은 채 다음 기회로 넘깁니다.
      if (selected) {
        if (deadlineExceeded("articleBody", deadlineAt)) break articlePlans;
      } else {
        assertStageFits("articleBody", deadlineAt);
      }
      const generated = await requestGeneratedContent({
        prompt: `${basePrompt}${repairInstruction}`,
        scheduleKey,
      });
      // 규칙대로 문장마다 줄을 바꿔 저장합니다.
      // 화면에서만 바꾸던 때에는 미리보기마다 모습이 달랐습니다.
      generated.bodyHtml = insertSentenceBreaks(sanitizeGeneratedHtml(generated.bodyHtml || ""));
      generated.faq = (generated.faq || []).map((faq) => ({
        ...faq,
        question: sanitizeInlineHtml(faq.question || ""),
        answer: sanitizeInlineHtml(faq.answer || ""),
      }));
      generated.usedKnowledgeIds = [...new Set(generated.usedKnowledgeIds || [])]
        .filter((id) => approvedKnowledgeIds.has(id) && plan.knowledgeIds.includes(id));
      const allowedSourceUrls = new Set(sourcePool.map((source) => source.base_url));
      generated.sourceUrls = [...new Set(generated.sourceUrls || [])]
        .filter((url) => allowedSourceUrls.has(url));
      const plainLength = clean(generated.bodyHtml).replace(/\s/g, "").length;
      const h2Count = (generated.bodyHtml.match(/<h2[\s>]/gi) || []).length;
      const faqCount = generated.faq?.length || 0;
      const designForbidden = slot.channel === "naver_design"
        && /정부지원사업|정책자금|지원금|융자|기업인증/.test(`${generated.title} ${generated.summary}`);
      const internalLabel = /\[naver_design\]|naver_design/i.test(generated.title || "");
      const authorityMissingKnowledge = requiresKnowledge && !generated.usedKnowledgeIds.length;
      const novelty = assessNovelty({
        candidate: fingerprintFromGenerated({ generated, plan }),
        existing,
        stage: "article",
      });
      const structuralIssues = [
        ...(plainLength < 2000 ? [`본문 ${plainLength}자 — 최소 2,000자, 목표 3,500자로 확장`] : []),
        ...(h2Count < 3 ? [`H2 ${h2Count}개 — 최소 3개로 보완`] : []),
        ...(designForbidden ? ["디자인 채널에서 금지된 컨설팅 주제"] : []),
        ...(internalLabel ? ["제목에 내부 채널 표기"] : []),
        ...(authorityMissingKnowledge ? [`${knowledgeFormatLabel(slot)}에 승인된 원천자료가 사용되지 않음`] : []),
        ...editorialPublicationIssues(slot.format, generated),
      ];
      const duplicateNote = novelty.duplicate
        ? `기존 글과 중복 위험 ${novelty.riskScore}점${novelty.matches[0] ? `: ${novelty.matches[0].title}` : ""}`
        : "";
      const issues = [
        ...structuralIssues,
        // 주제를 지정받았을 때의 중복은 막을 일이 아니라 알려 줄 일입니다.
        // 아래 경고로 남겨 검토 화면에서 보이게 합니다.
        ...(duplicateNote && !skipDuplicateBlock ? [duplicateNote] : []),
      ];
      attempts.push({
        title: generated.title,
        riskScore: novelty.riskScore,
        duplicate: novelty.duplicate,
        issues,
      });
      const candidate = {
        generated,
        plan,
        novelty,
        issues,
        plainLength,
        h2Count,
        faqCount,
        usedKnowledgeIds: generated.usedKnowledgeIds,
        sourcePool,
      };
      const candidateIsBetter = !selected
        || candidate.issues.length < selected.issues.length
        || (
          candidate.issues.length === selected.issues.length
          && candidate.novelty.riskScore < selected.novelty.riskScore
        )
        || (
          candidate.issues.length === selected.issues.length
          && candidate.novelty.riskScore === selected.novelty.riskScore
          && candidate.plainLength > selected.plainLength
        );
      if (candidateIsBetter) selected = candidate;
      if (!issues.length) {
        selected = candidate;
        break articlePlans;
      }
      if (repairAttempt === 0 && !novelty.duplicate && structuralIssues.length) {
        repairInstruction = `

직전 초안은 자동 검증을 통과하지 못했습니다.
검증 실패 항목: ${structuralIssues.join(", ")}
같은 주제와 근거를 유지하되 내용을 처음부터 다시 작성하세요. 반복 문장이나 근거 없는 부연으로 분량을 채우지 말고, 판단 기준·적용 순서·예시·주의점을 보강해 공백 제외 약 3,500자로 완성하세요.
직전 초안:
${JSON.stringify(generated)}
반드시 모든 검증 실패 항목을 고친 완전한 JSON 객체만 반환하세요.`;
        continue;
      }
      break;
    }
  }
  if (!selected) throw new Error("본문 후보를 만들지 못했습니다.");
  const { generated, plan, novelty, issues, plainLength, h2Count, faqCount, sourcePool } = selected;
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    throw new Error("GENERATION_CANCELLED");
  }
  const status = issues.length ? "on_hold" : "review_required";
  // 막지는 않았지만 알고 계셔야 하는 것들입니다.
  // 읽지 못한 링크와, 지정 주제라서 넘긴 중복 경고가 여기 모입니다.
  const advisories = [
    ...(rejectedBriefUrls.length
      ? [`읽지 않은 링크 ${rejectedBriefUrls.length}개: ${rejectedBriefUrls.join(", ")}`
        + " (정부·공공기관·학교·공식 통계 주소만 조사에 사용합니다)"]
      : []),
    ...(unreadableBriefUrls.length
      ? [`열지 못한 링크 ${unreadableBriefUrls.length}개: ${unreadableBriefUrls.join(", ")}`
        + " (주소가 바뀌었거나 응답이 없었습니다)"]
      : []),
    ...(brief && novelty.duplicate
      ? [`지정하신 주제라 그대로 진행했지만, 기존 글과 겹치는 정도가 ${novelty.riskScore}점입니다.`
        + `${novelty.matches[0] ? ` 가장 비슷한 글: ${novelty.matches[0].title}` : ""}`]
      : []),
  ];
  const usedSourceNames = sourcePool
    .filter((source) => generated.sourceUrls.some((url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, "")
          === new URL(source.base_url).hostname.replace(/^www\./, "");
      } catch {
        return false;
      }
    }))
    .map((source) => source.name);
  const successfulMetadata = metadataAfterSuccessfulRevision(storedMetadata);
  const generatedAt = new Date().toISOString();
  const selectedResearchKey = `${plan.topicFamily}|${plan.primaryTopic}`;
  const selectedResearch = researchCache.get(selectedResearchKey) || null;
  const { data, error } = await admin.from("content_work_items").update({
    title: generated.title,
    summary: generated.summary || "",
    status,
    retry_count: 0,
    next_retry_at: null,
    last_error_code: null,
    last_error_context: {},
    review_note: status === "on_hold"
      ? [`${novelty.duplicate ? "중복 검사" : "자동 검증"} 보류: ${issues.join(", ")}`, ...advisories].join(" / ")
      : (advisories.join(" / ") || null),
    source_label: (usedSourceNames.length ? usedSourceNames : sourcePool.map((source) => source.name)).join(", "),
    source_reference: JSON.stringify(generated.sourceUrls || []),
    metadata: {
      ...successfulMetadata,
      generated,
      ...(brief ? {
        brief: {
          topicHint: brief.topicHint || null,
          hasSourceMaterial: Boolean(brief.sourceMaterial),
          sourceUrls: [...readBriefUrls],
          rejectedSourceUrls: rejectedBriefUrls,
          unreadableSourceUrls: unreadableBriefUrls,
          requestedAt: generatedAt,
        },
      } : {}),
      ...(status === "review_required" ? {
        styleRevision: createStyleRevisionStamp(generated, {
          appliedAt: generatedAt,
          appliedBy: "system-generation",
        }),
      } : {}),
      sourceChannel: slot.channel,
      // 다음 수정 요청에서 Google 검색 조사를 다시 실행하지 않도록 이번 조사 결과를 보관합니다.
      ...(selectedResearch ? {
        research: {
          dossier: selectedResearch.dossier,
          sources: selectedResearch.sources,
          topicKey: selectedResearchKey,
          savedAt: generatedAt,
        },
      } : {}),
      validation: { plainLength, h2Count, faqCount, issues },
      novelty: {
        plan,
        duplicate: novelty.duplicate,
        riskScore: novelty.riskScore,
        threshold: novelty.threshold,
        matches: novelty.matches,
        attempts,
        rationale: plan.rationale,
        checkedAt: generatedAt,
        lookbackDays: NOVELTY_LOOKBACK_DAYS,
      },
      generatedAt,
      ...(revisionNote ? {
        lastRevision: {
          note: revisionNote,
          appliedAt: generatedAt,
        },
      } : {}),
    },
    updated_at: generatedAt,
  }).eq("schedule_key", scheduleKey).select().single();
  if (error) throw new Error(error.message);
  if (status === "review_required" && selected.usedKnowledgeIds.length) {
    await Promise.all(selected.usedKnowledgeIds.map(async (id) => {
      const item = knowledge.find((entry) => entry.id === id);
      if (!item) return;
      await admin.from("column_expert_knowledge").update({
        use_count: item.use_count + 1,
        last_used_at: new Date().toISOString(),
      }).eq("id", id);
    }));
  }
  return data;
}
