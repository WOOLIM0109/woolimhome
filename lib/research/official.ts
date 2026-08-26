import { generateGeminiText, type GeminiGroundingSource } from "@/lib/gemini/client";

const MODEL = "gemini-3.5-flash";

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isGoogleGroundingRedirect(url: URL) {
  const host = url.hostname.toLowerCase();
  return (host === "vertexaisearch.cloud.google.com" || host.endsWith(".google.com"))
    && /grounding|redirect/i.test(`${url.pathname}${url.search}`);
}

async function resolveGroundingSource(source: GeminiGroundingSource) {
  const parsed = safeHttpsUrl(source.url);
  if (!parsed) return null;
  if (!isGoogleGroundingRedirect(parsed)) return { ...source, url: parsed.toString() };
  try {
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WoolimResearch/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    const resolved = safeHttpsUrl(response.url);
    return resolved ? { ...source, url: resolved.toString() } : { ...source, url: parsed.toString() };
  } catch {
    return { ...source, url: parsed.toString() };
  }
}

export async function researchOfficialFacts(input: {
  topic: string;
  sourceContext: string;
  maxSources?: number;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const prompt = `당신은 울림컴퍼니 콘텐츠의 공식자료 조사 담당자입니다.

오늘 날짜: ${today}
작성 주제: ${input.topic}

[필수 조사 규칙]
1. 아래 원천자료에서 외부 확인이 가능한 사실을 모두 찾습니다. 제도명, 사업명, 법령·규정, 금액, 기간, 대상, 자격, 지원 조건, 통계, 시장 수치, 기술 기준, 기관명은 각각 별도의 주장으로 나눕니다.
2. 나눈 주장을 하나씩 개별 검색합니다. 여러 주장을 한 번에 추정해서 묶지 않습니다.
3. 출처를 댈 수 있으면 확인 완료로 봅니다. 정부·공공기관·법령·주관기관의 공식 원문뿐 아니라 언론 기사, 학회·협회 자료, 기업의 공식 발표도 근거가 됩니다.
   다만 개인 블로그, 광고성 글, 출처 없는 검색 결과 요약만으로는 확인 완료로 판단하지 않습니다.
   금액·마감일·자격 요건은 같은 내용을 담은 공고 원문이 있으면 원문 쪽을 먼저 씁니다. 기사가 원문의 숫자를 잘못 옮기는 일이 있기 때문입니다.
4. 최신 자료인지 날짜와 적용 시점을 확인하고, 서로 다른 자료가 충돌하면 더 최신인 공식 원문을 따릅니다.
5. 출처를 하나도 대지 못한 사실은 추측하거나 사용자에게 떠넘기지 말고 반드시 '본문 제외'로 분류합니다.
6. 고객명, 계약 내용, 구체적인 내부 사례처럼 그 회사를 특정할 수 있는 사실은 조사하지 말고 '대표 확인 필요'로 분류합니다.
   다만 회사를 특정할 수 없는 정량 지표(예: "2년간 N억", "평균 3개월", "3건 중 2건")는 출처를 표기해 본문에 쓸 수 있습니다.

[결과 형식]
[공식 확인 완료]
- 주장 / 확인된 내용 / 기준일 / 출처(기관 또는 매체)
[공식자료 미확인 · 본문 제외]
- 주장 / 찾지 못한 이유
[외부 조사 불가 · 대표 확인 필요]
- 비공개 또는 내부 사실

각 주장을 빠뜨리지 말고 조사 결과만 간결하게 작성하세요.

[원천자료]
${input.sourceContext.slice(0, 35_000)}`;
  const result = await generateGeminiText({
    model: MODEL,
    parts: [{ text: prompt }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 10_000 },
    timeoutMs: 120_000,
  });
  const resolved = await Promise.all(result.groundingSources.map(resolveGroundingSource));
  const sources = [...new Map(resolved
    .filter((source): source is GeminiGroundingSource => Boolean(source))
    .map((source) => [source.url, source])).values()]
    .slice(0, input.maxSources || 10);
  return {
    dossier: result.text,
    sources,
    searchQueries: result.searchQueries,
  };
}
