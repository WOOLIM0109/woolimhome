import { createAdminClient } from "@/lib/supabase/admin";
import { generateGeminiText, geminiRetryDecision } from "@/lib/gemini/client";
import { parseGeminiJson } from "@/lib/gemini/json";
import { researchOfficialFacts } from "@/lib/research/official";
import { AI_INPUT_LIMITS, AI_OUTPUT_LIMITS, COLUMN_MIN_BODY_CHARS } from "@/lib/ai-budget";
import { sanitizeGeneratedHtml, sanitizeInlineHtml } from "@/lib/security/html";
import {
  FRIENDLY_EDITORIAL_STYLE_RULES,
  friendlyStyleIssues,
} from "@/lib/content-ops/editorial-style";
import {
  KNOWLEDGE_PER_COLUMN,
  KNOWLEDGE_POOL_LIMIT,
  selectRotatingKnowledge,
} from "./knowledge-rotation";
import { stripVerificationControlText } from "./verification";
import type { ColumnFaq, ColumnKind, ColumnSource } from "./types";

const MODEL = "gemini-3.5-flash";
/** 문체만 걸렸을 때 다시 써 보는 횟수. 한 번 고치면 다른 곳이 걸리는 일이 잦습니다. */
const STYLE_REPAIR_ATTEMPTS = 2;
const OFFICIAL_FEEDS = [
  { url: "https://mss.go.kr/rss/smba/board/310.do", publisher: "중소벤처기업부", label: "사업공고" },
  { url: "https://mss.go.kr/rss/smba/board/86.do", publisher: "중소벤처기업부", label: "보도자료" },
  { url: "https://mss.go.kr/rss/smba/board/126.do", publisher: "중소벤처기업부", label: "법령공고" },
];
const TRUSTED_SUFFIXES = [
  ".go.kr", ".or.kr", ".ac.kr", "law.go.kr", "k-startup.go.kr", "bizinfo.go.kr",
  "kostat.go.kr", "kosis.kr", "doi.org", "oecd.org", "worldbank.org",
];

type Candidate = ColumnSource & { summary: string };
type Generated = {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  contentKind: ColumnKind;
  audience: string;
  coreMessage: string;
  tags: string[];
  bodyHtml: string;
  faqs: ColumnFaq[];
  usedSourceUrls: string[];
  usedKnowledgeIds?: string[];
  expertQuestions?: string[];
};

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function rssCandidates(): Promise<Candidate[]> {
  const results = await Promise.allSettled(OFFICIAL_FEEDS.map(async (feed) => {
    const response = await fetch(feed.url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
      const item = match[1];
      const field = (name: string) => decodeXml(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
      return {
        title: field("title"),
        url: field("link"),
        publisher: feed.publisher,
        publishedAt: field("pubDate") || null,
        summary: `${feed.label}: ${field("description")}`.slice(0, 1200),
      };
    }).filter((item) => item.title && item.url);
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function trustedUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return TRUSTED_SUFFIXES.some((suffix) => host === suffix.replace(/^\./, "") || host.endsWith(suffix));
  } catch {
    return false;
  }
}

async function suppliedCandidate(url: string): Promise<Candidate | null> {
  if (!trustedUrl(url)) return null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const raw = await response.text();
    const title = decodeXml(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url);
    const text = decodeXml(raw).slice(0, 5000);
    return { title, url, publisher: new URL(url).hostname, summary: text, publishedAt: null };
  } catch {
    return null;
  }
}

function visibleText(html: string) {
  return decodeXml(html);
}

function safeSlug(value: string) {
  return value.toLowerCase().trim()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 90);
}

function faqHtml(faqs: ColumnFaq[]) {
  return `<section class="column-faq"><h2>자주 묻는 질문</h2>${faqs
    .map((faq) => `<h3><strong>${escapeHtml(faq.question)}</strong></h3><p>${escapeHtml(faq.answer)}</p>`)
    .join("")}</section>`;
}

function sourceHtml(sources: ColumnSource[]) {
  return `<section class="column-sources"><h2>참고자료</h2><ul>${sources
    .map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a> · ${escapeHtml(source.publisher)}</li>`)
    .join("")}</ul></section>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function generateColumn(input: {
  topicHint?: string;
  sourceUrls?: string[];
  createdBy: string;
  /** 어느 회차로 만든 글인지 기록에 남깁니다. 밀린 회차를 세는 데 씁니다. */
  scheduleKey?: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const admin = createAdminClient();
  const [{ data: knowledge }, feedSources, supplied] = await Promise.all([
    // 승인 자료를 넉넉히 읽고, 어떤 열두 개를 쓸지는 아래에서 돌아가며 고릅니다.
    admin.from("column_expert_knowledge").select("*").eq("approved", true)
      .order("created_at", { ascending: false }).limit(KNOWLEDGE_POOL_LIMIT),
    rssCandidates(),
    Promise.all((input.sourceUrls || []).slice(0, 8).map(suppliedCandidate)),
  ]);
  const writingKnowledge = selectRotatingKnowledge(knowledge || [], KNOWLEDGE_PER_COLUMN).map((item) => ({
    ...item,
    raw_text: stripVerificationControlText(item.raw_text).slice(0, AI_INPUT_LIMITS.knowledgeRawText),
    perspective: stripVerificationControlText(item.perspective),
    case_evidence: stripVerificationControlText(item.case_evidence),
    differentiator: stripVerificationControlText(item.differentiator),
  }));
  const baseCandidates = [...supplied.filter((item): item is Candidate => Boolean(item)), ...feedSources].slice(0, 24);
  if (baseCandidates.length < 2) throw new Error("검증 가능한 공식 출처를 충분히 수집하지 못했습니다.");
  const research = await researchOfficialFacts({
    topic: input.topicHint || "울림컴퍼니 기업 컨설팅 칼럼",
    sourceContext: JSON.stringify({
      topicHint: input.topicHint || null,
      woolimKnowledge: writingKnowledge,
      officialSources: baseCandidates.map((source) => ({
        title: source.title,
        url: source.url,
        publisher: source.publisher,
        summary: source.summary.slice(0, 2500),
      })),
    }),
  });
  const researchCandidates: Candidate[] = research.sources.map((source) => ({
    title: source.title,
    url: source.url,
    publisher: (() => {
      try { return new URL(source.url).hostname; } catch { return "공식 원문"; }
    })(),
    publishedAt: null,
    summary: `Google Search 개별 조사에서 확인된 공식 원문: ${source.title}`,
  }));
  const candidates = [...new Map([...baseCandidates, ...researchCandidates]
    .map((source) => [source.url, source])).values()].slice(0, 30);

  const run = await admin.from("column_generation_runs").insert({
    status: "started",
    model: MODEL,
    request_payload: {
      topicHint: input.topicHint,
      sourceUrls: input.sourceUrls,
      ...(input.scheduleKey ? { scheduleKey: input.scheduleKey } : {}),
    },
    created_by: input.createdBy,
  }).select("id").single();
  if (run.error) throw new Error(run.error.message);

  const prompt = `
당신은 울림컴퍼니의 수석 콘텐츠 기획자다. 한국 기업 고객이 문제를 해결하고 성장하도록 돕는 전문적이면서 친근한 칼럼을 작성한다.

[브랜드 업역]
종합 경영컨설팅, 정부지원사업, 정책자금, 사업계획서, IR, 법인설립, 입찰·PPT 기획 및 디자인.
대표는 기획 전문가다. 기획은 전략·서비스·콘텐츠·문서·시각화 기획을 아우르는 독립 핵심 분야다.

[콘텐츠 매뉴얼]
${FRIENDLY_EDITORIAL_STYLE_RULES}
- 유형은 informational(공식 정보 중심), hybrid(공식 정보+울림 관점), authority(인터뷰·사례 중심) 중 하나다.
- 한 명의 독자, 실제 검색어, 핵심 메시지 한 문장을 먼저 정한다.
- 내부 흐름은 공감 도입 → 흔한 실수 → 울림의 관점 → 사례·증거 → 실행 방법 → 부담 없는 CTA다.
- 위 내부 칸 이름과 번호를 소제목으로 노출하지 말고 자연스러운 H2/H3로 바꾼다.
- 쉬운 말로 쓰되 전문적 알맹이는 유지한다.
- 사실·금액·기한은 아래 출처에서만 사용한다. 선정, 대출, 지원 결과를 보장하지 않는다.
- 제도명, 금액, 기간, 대상, 자격, 지원 조건, 통계, 법령, 기술 기준은 각각 별도의 주장으로 보고 아래 개별 조사 결과와 대조한다.
- [공식 확인 완료] 사실만 사용하고, [공식자료 미확인 · 본문 제외] 항목은 '확인 필요'라고 독자나 대표에게 넘기지 말고 본문에서 제외한다.
- [외부 조사 불가 · 대표 확인 필요] 항목은 공개 동의가 확인된 승인 원천자료가 아니면 본문에 쓰지 않는다.
- FAQ는 정확히 3~4개, 질문은 실제 기업 고객의 말로 쓴다.
- 불필요한 비유와 수식어를 빼고 결론부터 쓴다. 한 문장에는 한 가지 판단이나 행동만 담고, 100자를 넘기기 전에 나눈다.
- FAQ 답변은 결론부터 1~2문장으로 쓰고 공백 제외 180자를 넘기지 않는다.
- 목표는 한글 가시문자 3,500자 이상이다. 불필요한 반복으로 늘리지 않는다.
- HTML은 h2,h3,p,ul,ol,li,strong,blockquote,a 와 표(table,thead,tbody,tr,th,td) 태그만 사용한다.
- 표는 글로 풀면 오히려 읽기 힘든 곳에만 쓴다. 두 제도를 항목별로 견주거나,
  연도·금액·대상 같은 값이 여럿 나란히 놓일 때가 그런 자리다.
  줄글로 충분한 내용을 표로 바꾸지 않는다. 한 편에 많아야 두 개까지 쓴다.
- 표를 쓸 때는 첫 줄을 th 로 된 머리글 행으로 만들고, 칸 안은 짧게 끊어 쓴다.
  긴 설명이 필요하면 표 대신 문단으로 쓴다.
- FAQ와 참고자료 섹션은 bodyHtml에 넣지 않는다(시스템이 붙인다).
- 노하우 자료에 없는 경험·성과·사례는 절대 창작하지 않는다.
- hybrid와 authority도 노하우 원문을 요약하는 글이 아니다. 최소 2개의 공식 외부 출처로 사실과 검색 수요를 보강하고,
  원천자료는 울림만의 판단 기준·해석·실무 사례를 만드는 차별화 근거로 사용한다.
- hybrid와 authority는 '대표 목소리 보존 + 전문성 증폭' 방식으로 작성한다.
  대표가 실제로 말한 주장·판단 순서·사례·특징적인 어휘가 글의 중심이어야 하며, 이를 흔한 컨설팅 문구나 과장된 전문가 문체로 치환하지 않는다.
- 글의 핵심 주장 중 60% 이상은 usedKnowledgeIds의 원천자료에서 의미를 직접 추적할 수 있어야 한다.
  공식 자료와 연구는 대표의 말을 대신하지 않고 사실 확인·배경 설명·검색 수요를 보강하는 중립적인 근거로만 사용한다.
- 원천자료에 있는 대표의 특징적인 문장이나 표현을 1~3개 골라 blockquote로 인용한다. 문법상 필요한 최소한의 정리만 하고 의미와 어휘를 바꾸지 않는다.
- 대표가 말하지 않은 경험·성과·의견을 대표의 말처럼 쓰지 않는다. 공식 출처의 내용과 대표의 관점을 한 문장 안에서 섞어 새로운 주장을 만들지 않는다.
- 전문성은 어려운 용어가 아니라 '무엇을 먼저 보는지 → 무엇을 버리는지 → 왜 그렇게 판단하는지 → 실제로 어떻게 적용하는지'가 드러나게 한다.
- 가능하면 각 핵심 구간에 대표의 판단 → 그 이유 → 실제 사례 → 공식 근거 → 독자가 적용할 기준이 이어지게 한다.
- 제목과 H2/H3는 실제 고객이 검색할 쉬운 말로 쓰고, 객관적 근거 → 울림의 해석 → 실행 방법이 이어지게 한다.

[주제 힌트]
${input.topicHint || "공식 자료 중 기업 고객에게 시의성 있고 울림의 서비스와 자연스럽게 연결되는 주제를 선택"}

[승인된 울림 원천자료]
${writingKnowledge.length ? JSON.stringify(writingKnowledge) : "없음. 이 경우 informational 유형만 선택한다."}

[개별 공식 조사 결과]
${research.dossier}

[사용 가능한 공식 출처]
${JSON.stringify(candidates)}

JSON만 반환:
{
 "title":"","slug":"","excerpt":"","category":"",
 "contentKind":"informational|hybrid|authority",
 "audience":"","coreMessage":"","tags":[""],
 "bodyHtml":"<h2>...</h2>...",
 "faqs":[{"question":"","answer":""}],
 "usedSourceUrls":["위 출처 URL만"],
 "usedKnowledgeIds":["실제로 활용한 승인 원천자료 id만"],
 "expertQuestions":["hybrid/authority인데 원천자료가 부족할 때 대표에게 물을 질문 2~3개"]
}`;

  const requestGemini = async (promptText: string) => {
    const { text } = await generateGeminiText({
      model: MODEL,
      parts: [{ text: promptText }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: AI_OUTPUT_LIMITS.columnBody },
      timeoutMs: 120_000,
    });
    return parseGeminiJson<Generated>(text);
  };

  /** 글 전체가 아니라 바뀔 조각만 돌려받습니다. 응답이 잘릴 위험을 줄입니다. */
  const requestGeminiPart = async (promptText: string) => {
    const { text } = await generateGeminiText({
      model: MODEL,
      parts: [{ text: promptText }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_OUTPUT_LIMITS.columnBody,
      },
      timeoutMs: 120_000,
    });
    return parseGeminiJson<Pick<Generated, "bodyHtml" | "faqs">>(text);
  };

  try {
    /**
     * 응답을 읽지 못하면 한 번만 다시 부릅니다.
     *
     * 모델이 JSON 뒤에 설명을 덧붙이거나 응답이 잘리는 일이 있습니다.
     * 그럴 때 그대로 실패시키면 조사에 쓴 호출까지 함께 버려집니다.
     * 실제로 칼럼 한 편이 이 자리에서 사라졌습니다.
     */
    let generated: Generated;
    try {
      generated = await requestGemini(prompt);
    } catch {
      generated = await requestGemini(`${prompt}

반드시 JSON 객체 하나만 반환하세요. 앞뒤에 설명 문장이나 코드 울타리를 붙이지 마세요.`);
    }
    generated.bodyHtml = sanitizeGeneratedHtml(generated.bodyHtml || "");
    generated.faqs = (generated.faqs || []).map((faq) => ({
      question: sanitizeInlineHtml(faq.question || ""),
      answer: sanitizeInlineHtml(faq.answer || ""),
    }));
    let initialCharCount = visibleText(generated.bodyHtml).replace(/\s/g, "").length;
    // 여기서 걸리면 글 전체를 한 번 더 생성하므로 비용이 두 배가 됩니다.
    if (initialCharCount < COLUMN_MIN_BODY_CHARS) {
      generated = await requestGemini(`
다음 JSON은 최소 분량에 미달한 한국어 비즈니스 칼럼 초안입니다.
군더더기, 반복, 출처에 없는 사실을 추가하지 말고 한국어 가시 문자 3,500~4,000자로 다시 작성하세요.
JSON 구조, contentKind, usedSourceUrls, FAQ 3~4개는 유지하세요.
실무 설명, 판단 기준, 예시, 실행 단계를 자연스러운 H2/H3 구조로 보강하세요.
hybrid 또는 authority라면 원천자료의 대표 표현과 판단 맥락을 유지하고, 일반적인 전문가 문체로 다시 쓰지 마세요.
대표가 실제로 말한 특징적인 표현을 blockquote로 1~3개 보존하고, 공식 자료는 별도의 근거로만 보강하세요.
JSON만 반환하세요.

${JSON.stringify(generated)}
`);
      generated.bodyHtml = sanitizeGeneratedHtml(generated.bodyHtml || "");
      generated.faqs = (generated.faqs || []).map((faq) => ({
        question: sanitizeInlineHtml(faq.question || ""),
        answer: sanitizeInlineHtml(faq.answer || ""),
      }));
      initialCharCount = visibleText(generated.bodyHtml).replace(/\s/g, "").length;
    }

    const inspect = (draft: typeof generated) => {
      const sources = draft.usedSourceUrls
        .map((url) => candidates.find((source) => source.url === url))
        .filter((source): source is Candidate => Boolean(source));
      const approvedKnowledgeIds = new Set(writingKnowledge.map((item) => item.id));
      const knowledgeIds = [...new Set(draft.usedKnowledgeIds || [])]
        .filter((id) => approvedKnowledgeIds.has(id));
      const found: string[] = [];
      const chars = visibleText(draft.bodyHtml).replace(/\s/g, "").length;
      const headings = (draft.bodyHtml.match(/<h2[\s>]/gi) || []).length;
      const quotes = (draft.bodyHtml.match(/<blockquote[\s>]/gi) || []).length;
      if (chars < COLUMN_MIN_BODY_CHARS) found.push(`본문이 짧습니다(${chars}자).`);
      if (headings < 3) found.push("H2가 3개 미만입니다.");
      if (draft.faqs.length < 3 || draft.faqs.length > 4) found.push("FAQ는 3~4개여야 합니다.");
      const styleIssues = friendlyStyleIssues(draft.bodyHtml, draft.faqs);
      found.push(...styleIssues);
      if (sources.length < 2) found.push("독립된 공식 출처가 2개 미만입니다.");
      if (draft.contentKind !== "informational" && !writingKnowledge.length) {
        found.push("하이브리드·권위형에 필요한 승인된 원천자료가 없습니다.");
      }
      if (draft.contentKind !== "informational" && knowledgeIds.length === 0) {
        found.push("대표님의 승인 원천자료를 실제로 사용하지 않았습니다.");
      }
      if (draft.contentKind !== "informational" && quotes < 1) {
        found.push("대표님의 실제 표현을 보존한 인용문이 없습니다.");
      }
      if (/<script|<iframe|on\w+=|javascript:/i.test(draft.bodyHtml)) {
        found.push("허용되지 않은 HTML이 있습니다.");
      }
      return {
        issues: found,
        styleIssues,
        usedSources: sources,
        usedKnowledgeIds: knowledgeIds,
        charCount: chars,
        h2Count: headings,
        blockquoteCount: quotes,
      };
    };

    let checked = inspect(generated);

    /**
     * 문체만 걸렸을 때 글을 버리지 않고 그 부분만 고쳐 씁니다.
     *
     * 예전에는 상투 문구 하나 때문에 3,500자 칼럼이 통째로 사라졌습니다.
     * 조사와 작성에 쓴 호출은 그대로 버려지고 남는 것이 없었습니다.
     * 자료·분량 문제가 아니라 표현만 걸렸다면 그 부분만 다시 씁니다.
     * 한 곳을 고치면 다른 곳이 걸리는 일이 잦아 두 번까지 시도합니다.
     * 그래도 남으면 버리지 않고 아래에서 비공개 초안으로 저장합니다.
     */
    for (let attempt = 0; attempt < STYLE_REPAIR_ATTEMPTS; attempt += 1) {
      const styleOnly = checked.issues.length > 0
        && checked.issues.every((issue) => checked.styleIssues.includes(issue));
      if (!styleOnly) break;
      /**
       * 고쳐 쓰기가 실패해도 원래 글은 지킵니다.
       *
       * 예전에는 글 전체를 다시 받아 오게 했더니 응답이 잘려 JSON 이 깨졌고,
       * 그 오류가 위로 튀어 멀쩡히 써 둔 3,500자까지 함께 사라졌습니다.
       * 그래서 바뀔 부분만 돌려받고, 실패하면 조용히 원래 글을 씁니다.
       */
      let repaired: Generated | null = null;
      try {
        const patch = await requestGeminiPart(`
다음은 표현 규칙에 걸린 한국어 비즈니스 칼럼입니다.
아래 지적된 곳만 자연스러운 다른 말로 바꾸세요.
내용·구조·출처·분량은 그대로 두고, 사실을 새로 만들지 마세요.

{"bodyHtml": "고친 본문 HTML", "faqs": [{"question": "...", "answer": "..."}]}
위 두 항목만 담은 JSON 하나만 반환하세요. 다른 항목은 넣지 마세요.

[고칠 점]
${checked.issues.map((issue) => `- ${issue}`).join("\n")}

[본문]
${generated.bodyHtml}

[FAQ]
${JSON.stringify(generated.faqs)}
`);
        const bodyHtml = sanitizeGeneratedHtml(patch.bodyHtml || "");
        if (!bodyHtml.trim()) break;
        repaired = {
          ...generated,
          bodyHtml,
          faqs: (Array.isArray(patch.faqs) && patch.faqs.length
            ? patch.faqs
            : generated.faqs).map((faq) => ({
            question: sanitizeInlineHtml(faq.question || ""),
            answer: sanitizeInlineHtml(faq.answer || ""),
          })),
        };
      } catch {
        // 고쳐 쓰지 못했을 뿐입니다. 원래 글을 그대로 두고 넘어갑니다.
        break;
      }
      if (!repaired) break;
      const repairedCheck = inspect(repaired);
      // 고친 글이 더 나을 때만 씁니다. 더 나빠지면 처음 글을 그대로 둡니다.
      if (repairedCheck.issues.length >= checked.issues.length) break;
      generated = repaired;
      checked = repairedCheck;
    }

    const usedSources = checked.usedSources;
    const usedKnowledgeIds = checked.usedKnowledgeIds;
    const issues = checked.issues;
    const charCount = checked.charCount;
    const h2Count = checked.h2Count;
    const blockquoteCount = checked.blockquoteCount;

    /**
     * 다듬을 곳과 못 쓸 글을 갈라 봅니다.
     *
     * 출처가 모자라거나 분량이 짧은 글은 고쳐 쓸 수 없으니 버립니다.
     * 그러나 FAQ 한 줄이 길다는 이유로 3,500자를 버리는 것은 낭비였습니다.
     * 문체만 남았으면 비공개 초안으로 저장하고, 어디를 다듬을지 함께 적어 둡니다.
     * 발행은 어차피 사람이 확인한 뒤에 합니다.
     */
    const styleWarnings = issues.filter((issue) => checked.styleIssues.includes(issue));
    const blocked = issues.length > styleWarnings.length;
    if (blocked) {
      await admin.from("column_generation_runs").update({
        status: "blocked",
        response_payload: generated,
        validation_result: { issues, charCount, h2Count, blockquoteCount },
        completed_at: new Date().toISOString(),
      }).eq("id", run.data.id);
      return { blocked: true, issues, expertQuestions: generated.expertQuestions || [] };
    }

    const slugBase = safeSlug(generated.slug || generated.title);
    const { data: duplicate } = await admin.from("column_posts").select("id").eq("slug", slugBase).maybeSingle();
    const slug = duplicate ? `${slugBase}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}` : slugBase;
    const sourceRecords: ColumnSource[] = usedSources.map((source) => ({
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
    }));
    const content = `${generated.bodyHtml}${faqHtml(generated.faqs)}${sourceHtml(sourceRecords)}`;
    const { data: post, error: postError } = await admin.from("column_posts").insert({
      title: generated.title,
      slug,
      excerpt: generated.excerpt,
      content,
      tags: generated.tags,
      category: generated.category,
      content_kind: generated.contentKind,
      audience: generated.audience,
      core_message: generated.coreMessage,
      published: false,
      generation_status: styleWarnings.length ? "needs_style_fix" : "generated",
      generation_metadata: {
        run_id: run.data.id,
        sources: sourceRecords,
        faqs: generated.faqs,
        knowledge_ids: usedKnowledgeIds,
        validation: { charCount, h2Count, blockquoteCount, sourceCount: sourceRecords.length },
        styleWarnings,
      },
      author_email: input.createdBy,
    }).select().single();
    if (postError) throw new Error(postError.message);

    if (usedKnowledgeIds.length > 0) {
      await Promise.all(usedKnowledgeIds.map(async (id) => {
        const source = writingKnowledge.find((item) => item.id === id);
        if (!source) return;
        await admin.from("column_expert_knowledge").update({
          use_count: Number(source.use_count || 0) + 1,
          last_used_at: new Date().toISOString(),
        }).eq("id", id);
      }));
    }

    await admin.from("column_generation_runs").update({
      post_id: post.id,
      status: "generated",
      response_payload: generated,
      validation_result: {
        issues: [],
        styleWarnings,
        charCount,
        h2Count,
        blockquoteCount,
        sourceCount: sourceRecords.length,
      },
      completed_at: new Date().toISOString(),
    }).eq("id", run.data.id);
    return {
      blocked: false,
      post,
      styleWarnings,
      expertQuestions: generated.expertQuestions || [],
      validation: {
        charCount,
        h2Count,
        blockquoteCount,
        faqCount: generated.faqs.length,
        sourceCount: sourceRecords.length,
      },
    };
  } catch (error) {
    const retry = geminiRetryDecision(error, 0);
    await admin.from("column_generation_runs").update({
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      retry_count: retry.retryCount,
      next_retry_at: retry.nextRetryAt,
      last_error_code: retry.code,
      completed_at: new Date().toISOString(),
    }).eq("id", run.data.id);
    throw error;
  }
}
