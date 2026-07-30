import { createAdminClient } from "@/lib/supabase/admin";
import { PORTFOLIO_WRITING_RULES } from "./portfolio-rules";
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
  fingerprintFromGenerated,
  fingerprintFromPlan,
  type ComparableContent,
  type ContentPlan,
  type NoveltyAssessment,
} from "./novelty";
import {
  parseTopicPlans,
  TOPIC_PLAN_SCHEMA,
} from "./topic-planning";

type Source = {
  name: string;
  base_url: string;
  source_grade: number;
  topic_families: string[];
  channels: string[];
};

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

const MAX_ARTICLE_ATTEMPTS = 3;
const NOVELTY_LOOKBACK_DAYS = 90;
const AI_RESPONSE_TIMEOUT_MS = 90_000;

function clean(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safeHtml(value: string) {
  return value.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
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

function promptFor(
  slot: EditorialSlot,
  sources: unknown[],
  plan: ContentPlan,
  knowledge: ExpertKnowledge[],
  revision?: { note: string; previous?: GeneratedContent },
) {
  const designRules = slot.channel === "naver_design" ? `
이 글은 디자인 블로그 전용이다. 주제는 PPT·PDF·비즈니스 문서 기획, 정보 구조, 레이아웃, 가독성, 시각화, 디자인 시스템 중에서만 고른다.
정부지원사업·정책자금·기업인증·대출·지원금은 제목과 중심 주제로 사용할 수 없다.
울림이 실제로 수행하지 않은 프로젝트·성과·고객 반응을 만들지 않는다.
포트폴리오 사례처럼 쓰지 말고, 공식 디자인 자료를 실무자가 적용할 수 있도록 해설하는 기획·디자인 인사이트로 작성한다.
제목에 채널명이나 [naver_design] 같은 내부 표기를 넣지 않는다.` : "";
  const channel = slot.channel === "naver_design" ? "PPT·PDF·디자인·비즈니스 문서" : "종합 경영컨설팅";
  const formatRules = slot.format === "authority" ? `
이 글은 울림 콘텐츠형이다. 승인된 울림 원천자료가 글의 중심이어야 한다.
공식 자료는 울림의 판단을 뒷받침하는 사실 근거로만 사용하고, 여러 지원사업을 모은 종합 안내문으로 바꾸지 않는다.
usedKnowledgeIds에는 실제로 활용한 원천자료 id를 최소 1개 넣는다.
원천자료에 없는 경험·성과·의견은 만들지 않는다.
대표가 무엇을 먼저 보고 무엇을 버리는지, 왜 그렇게 판단하는지, 독자가 어떻게 적용하는지가 드러나야 한다.` : `
이 글은 정보형 또는 디자인 인사이트형이다. 한 가지 구체적인 고객 문제에 집중한다.
여러 제도·사업을 한꺼번에 나열한 종합 안내문을 만들지 않는다.
공식 출처는 실제로 본문에 사용한 2~4개만 sourceUrls에 넣는다.`;
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

선정된 주제 기획:
${JSON.stringify(plan)}

아래 공식 출처만 근거로 한국 기업 담당자가 이해하기 쉬운 초안을 작성하세요. 출처에 없는 숫자·요건·사례를 만들지 마세요. 전문 용어는 처음 나올 때 쉬운 설명을 붙이세요.

반드시 JSON만 반환하세요:
{"title":"","summary":"","bodyHtml":"<h2>...</h2><p>...</p>","faq":[{"question":"","answer":""}],"tags":[""],"sourceUrls":[""],"usedKnowledgeIds":[""]}

조건: 본문은 공백 제외 약 3,500자를 목표로 충분히 설명하고, 어떤 경우에도 2,000자 미만으로 줄이지 마세요. H2 3개 이상, FAQ 3개. HTML은 h2,h3,p,ul,ol,li,strong,blockquote,a만 사용하세요. FAQ 질문은 실제 고객의 말투로 작성하세요.

승인된 울림 원천자료:
${knowledge.length ? JSON.stringify(knowledge) : "없음"}

출처:
${JSON.stringify(sources)}`;
}

function recentContentSummary(existing: ComparableContent[]) {
  return existing.slice(0, 30).map((item) => ({
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
  apiKey,
  slot,
  sources,
  knowledge,
  existing,
  scheduleKey,
}: {
  apiKey: string;
  slot: EditorialSlot;
  sources: (Source & { snapshot: string })[];
  knowledge: ExpertKnowledge[];
  existing: ComparableContent[];
  scheduleKey: string;
}) {
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    throw new Error("GENERATION_CANCELLED");
  }
  const authorityRules = slot.format === "authority" ? `
- 반드시 승인된 울림 원천자료 중 하나를 중심으로 삼고 knowledgeIds에 해당 id를 넣는다.
- 공식 지원사업을 모아 소개하는 종합 안내 주제는 금지한다.
- 울림의 판단 순서, 선택 기준, 실제 맥락이 중심이 되는 후보만 만든다.` : `
- 공식 자료에서 한 가지 구체적인 고객 문제를 고른다.
- 여러 지원사업·제도·기능을 한 글에 모은 종합 안내 주제는 금지한다.
- knowledgeIds는 빈 배열로 반환한다.`;
  const designRules = slot.channel === "naver_design" ? `
- 디자인 채널 후보는 PPT·PDF·비즈니스 문서의 기획, 정보 구조, 레이아웃, 가독성, 시각화에만 한정한다.
- 정부지원사업·정책자금·기업인증은 후보로 만들지 않는다.` : "";
  const prompt = `당신은 울림컴퍼니의 콘텐츠 편집장이다.
본문을 쓰기 전에 서로 충분히 다른 주제 후보 5개를 기획한다.

채널: ${slot.channel}
글 유형: ${slot.format}
${authorityRules}
${designRules}

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
    rawText: item.raw_text.slice(0, 3000),
  }))) : "없음"}

[사용 가능한 공식 출처]
${JSON.stringify(sources.map((source) => ({
    name: source.name,
    url: source.base_url,
    topicFamilies: source.topic_families,
    snapshot: source.snapshot.slice(0, 1800),
  })))}

후보마다 대주제, 구체 주제, 기존 글과 다른 관점, 한 명의 독자, 핵심 제도·사업·개념, 가제, 차별화 이유를 적는다.
JSON 객체만 반환한다.`;
  let lastFormatError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      throw new Error("GENERATION_CANCELLED");
    }
    const retryInstruction = attempt
      ? "\n\n이전 주제 후보 응답은 JSON 문법 오류로 읽지 못했습니다. 후보를 처음부터 다시 만들고 JSON 객체 외에는 아무 글자도 반환하지 마세요."
      : "";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${prompt}${retryInstruction}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: TOPIC_PLAN_SCHEMA,
            maxOutputTokens: 6000,
          },
        }),
        signal: AbortSignal.timeout(AI_RESPONSE_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`주제 기획 요청 실패: ${response.status}`);
    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
    try {
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
  apiKey,
  prompt,
  scheduleKey,
}: {
  apiKey: string;
  prompt: string;
  scheduleKey: string;
}) {
  let lastParseError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      throw new Error("GENERATION_CANCELLED");
    }
    const retryInstruction = attempt
      ? "\n\n이전 응답은 JSON 문법 오류로 읽지 못했습니다. 내용을 처음부터 다시 생성하고, JSON 객체 외에는 아무 글자도 반환하지 마세요."
      : "";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${prompt}${retryInstruction}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GENERATED_CONTENT_SCHEMA,
            maxOutputTokens: 12000,
          },
        }),
          signal: AbortSignal.timeout(AI_RESPONSE_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`AI 생성 요청 실패: ${response.status}`);
    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
    if (!raw) throw new Error("AI 응답이 비어 있습니다.");
    try {
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
  options: { revisionNote?: string | null; forceNewTopic?: boolean } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
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
    slot.format === "authority"
      ? admin.from("column_expert_knowledge")
        .select("id,topic,raw_text,perspective,case_evidence,differentiator,expertise_area,use_count")
        .eq("approved", true)
        .order("use_count", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(8)
      : Promise.resolve({ data: [] as ExpertKnowledge[], error: null }),
  ]);
  if (sourceError) throw new Error(sourceError.message);
  if (recentError) throw new Error(recentError.message);
  if (knowledgeResult.error) throw new Error(knowledgeResult.error.message);
  let knowledge = (knowledgeResult.data || []) as ExpertKnowledge[];
  if (slot.format === "authority" && pinnedKnowledgeIds.length) {
    const { data: pinnedKnowledge, error: pinnedKnowledgeError } = await admin
      .from("column_expert_knowledge")
      .select("id,topic,raw_text,perspective,case_evidence,differentiator,expertise_area,use_count")
      .eq("approved", true)
      .in("id", pinnedKnowledgeIds);
    if (pinnedKnowledgeError) throw new Error(pinnedKnowledgeError.message);
    const byId = new Map<string, ExpertKnowledge>();
    for (const item of [...(pinnedKnowledge || []), ...knowledge] as ExpertKnowledge[]) {
      byId.set(item.id, item);
    }
    knowledge = [...byId.values()];
  }
  if (slot.format === "authority" && !knowledge.length) {
    throw new Error("울림 콘텐츠형에 필요한 승인된 인터뷰·노하우 원천자료가 없습니다.");
  }
  const sources = (await Promise.all((registered || []).map(sourceSnapshot)))
    .filter((source): source is Source & { snapshot: string } => Boolean(source));
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
  const requestedPlans = revisionNote && !options.forceNewTopic && (previousPlan || fallbackPlan)
    ? [previousPlan || fallbackPlan as ContentPlan]
    : await requestTopicPlans({
      apiKey,
      slot,
      sources,
      knowledge,
      existing,
      scheduleKey,
    });
  const approvedKnowledgeIds = new Set(knowledge.map((item) => item.id));
  const planned = requestedPlans.map((plan) => ({
    plan: {
      ...plan,
      knowledgeIds: plan.knowledgeIds.filter((id) => approvedKnowledgeIds.has(id)),
    },
    assessment: assessNovelty({
      candidate: fingerprintFromPlan(plan),
      existing,
      stage: "plan",
    }),
  }));
  const eligiblePlans = planned.filter(({ plan, assessment }) =>
    (revisionNote && !options.forceNewTopic || !assessment.duplicate)
    && (slot.format !== "authority" || plan.knowledgeIds.length > 0));
  if (!eligiblePlans.length) {
    const strongest = planned
      .flatMap(({ assessment }) => assessment.matches)
      .sort((left, right) => right.score - left.score)[0];
    const missingKnowledge = slot.format === "authority"
      && planned.every(({ plan }) => !plan.knowledgeIds.length);
    const message = missingKnowledge
      ? "울림 원천자료를 중심으로 한 차별화 주제 후보가 없습니다."
      : `최근 글과 겹치지 않는 주제 후보가 없습니다.${strongest ? ` 가장 유사한 글: ${strongest.title}` : ""}`;
    const { data, error } = await admin.from("content_work_items").update({
      status: "on_hold",
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
  } | null = null;
  const attempts: {
    title: string;
    riskScore: number;
    duplicate: boolean;
    issues: string[];
  }[] = [];
  articlePlans:
  for (const { plan } of eligiblePlans.slice(0, MAX_ARTICLE_ATTEMPTS)) {
    const basePrompt = promptFor(
      slot,
      sources,
      plan,
      knowledge.filter((item) => plan.knowledgeIds.includes(item.id)),
      revisionNote && !options.forceNewTopic
        ? { note: revisionNote, previous: storedMetadata.generated }
        : undefined,
    );
    let repairInstruction = "";
    for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
      const generated = await requestGeneratedContent({
        apiKey,
        prompt: `${basePrompt}${repairInstruction}`,
        scheduleKey,
      });
      generated.bodyHtml = safeHtml(generated.bodyHtml || "");
      generated.usedKnowledgeIds = [...new Set(generated.usedKnowledgeIds || [])]
        .filter((id) => approvedKnowledgeIds.has(id) && plan.knowledgeIds.includes(id));
      const plainLength = clean(generated.bodyHtml).replace(/\s/g, "").length;
      const h2Count = (generated.bodyHtml.match(/<h2[\s>]/gi) || []).length;
      const faqCount = generated.faq?.length || 0;
      const designForbidden = slot.channel === "naver_design"
        && /정부지원사업|정책자금|지원금|융자|기업인증/.test(`${generated.title} ${generated.summary}`);
      const internalLabel = /\[naver_design\]|naver_design/i.test(generated.title || "");
      const authorityMissingKnowledge = slot.format === "authority" && !generated.usedKnowledgeIds.length;
      const novelty = assessNovelty({
        candidate: fingerprintFromGenerated({ generated, plan }),
        existing,
        stage: "article",
      });
      const structuralIssues = [
        ...(plainLength < 2000 ? [`본문 ${plainLength}자 — 최소 2,000자, 목표 3,500자로 확장`] : []),
        ...(h2Count < 3 ? [`H2 ${h2Count}개 — 최소 3개로 보완`] : []),
        ...(faqCount < 3 ? [`FAQ ${faqCount}개 — 정확히 3개 이상으로 보완`] : []),
        ...(designForbidden ? ["디자인 채널에서 금지된 컨설팅 주제"] : []),
        ...(internalLabel ? ["제목에 내부 채널 표기"] : []),
        ...(authorityMissingKnowledge ? ["울림 콘텐츠형에 승인된 원천자료가 사용되지 않음"] : []),
      ];
      const issues = [
        ...structuralIssues,
        ...(novelty.duplicate
          ? [`기존 글과 중복 위험 ${novelty.riskScore}점${novelty.matches[0] ? `: ${novelty.matches[0].title}` : ""}`]
          : []),
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
  const { generated, plan, novelty, issues, plainLength, h2Count, faqCount } = selected;
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    throw new Error("GENERATION_CANCELLED");
  }
  const status = issues.length ? "on_hold" : "review_required";
  const usedSourceNames = sources
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
  const { data, error } = await admin.from("content_work_items").update({
    title: generated.title,
    summary: generated.summary || "",
    status,
    review_note: status === "on_hold"
      ? `${novelty.duplicate ? "중복 검사" : "자동 검증"} 보류: ${issues.join(", ")}`
      : null,
    source_label: (usedSourceNames.length ? usedSourceNames : sources.map((source) => source.name)).join(", "),
    source_reference: JSON.stringify(generated.sourceUrls || []),
    metadata: {
      ...successfulMetadata,
      generated,
      sourceChannel: slot.channel,
      validation: { plainLength, h2Count, faqCount, issues },
      novelty: {
        plan,
        duplicate: novelty.duplicate,
        riskScore: novelty.riskScore,
        threshold: novelty.threshold,
        matches: novelty.matches,
        attempts,
        rationale: plan.rationale,
        checkedAt: new Date().toISOString(),
        lookbackDays: NOVELTY_LOOKBACK_DAYS,
      },
      generatedAt: new Date().toISOString(),
      ...(revisionNote ? {
        lastRevision: {
          note: revisionNote,
          appliedAt: new Date().toISOString(),
        },
      } : {}),
    },
    updated_at: new Date().toISOString(),
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
