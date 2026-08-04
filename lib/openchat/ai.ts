import { AFTERNOON_THEMES } from "./config";
import { assessHistoricalSimilarity } from "./novelty";
import type { CollectedProgram } from "./types";

const MODEL = "gemini-3.5-flash";

async function askGemini(prompt: string, maxOutputTokens = 12_000) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens,
          temperature: 0.35,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error(`Gemini 요청 실패: HTTP ${response.status}`);
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || "")
    .join("")
    .trim();
  if (!raw) throw new Error("Gemini 응답이 비어 있습니다.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Gemini 응답을 JSON으로 읽지 못했습니다.");
  }
}

export type ProgramAnalysis = {
  sourceKey: string;
  externalId?: string | null;
  title: string;
  url: string;
  keep: boolean;
  exclusionReason?: string;
  applicantSummary: string;
  supportSummary: string;
  applicationMethod: string;
  startsAt?: string | null;
  deadlineAt?: string | null;
  regions: string[];
  categories: string[];
  priority: number;
};

export async function analyzePrograms(programs: CollectedProgram[]) {
  if (!process.env.GEMINI_API_KEY) {
    return programs.map((program): ProgramAnalysis => ({
      sourceKey: program.sourceKey,
      externalId: program.externalId,
      title: program.title,
      url: program.url,
      keep: true,
      applicantSummary: "- 신청 대상은 공고문 확인이 필요합니다.",
      supportSummary: "- 지원 내용은 공고문 확인이 필요합니다.",
      applicationMethod: program.applicationMethod || "접수방법은 공고문 참조",
      startsAt: program.startsAt,
      deadlineAt: program.deadlineAt,
      regions: [],
      categories: [],
      priority: 100,
    }));
  }

  const compact = programs.map((program, index) => ({
    index,
    sourceKey: program.sourceKey,
    externalId: program.externalId || null,
    title: program.title,
    url: program.url,
    knownStartsAt: program.startsAt || null,
    knownDeadlineAt: program.deadlineAt || null,
    knownApplicationMethod: program.applicationMethod || null,
    text: (program.rawText || program.title).slice(0, 8_000),
  }));
  const result = await askGemini(`당신은 대한민국 정부지원사업 공고 편집자입니다.
아래 공고 후보를 검토해 오픈채팅 게시 후보를 JSON으로 정리하세요.

포함:
- 중앙정부 또는 중소벤처기업부 공고
- 전국 신청 가능 공고
- 부산·울산·경남 기업 또는 예비창업자가 신청 가능한 공고
- 창업, 사업화, R&D, 시제품, 판로, 수출, 정책자금, 스마트화, 소상공인 지원

제외:
- 부산·울산·경남 외 특정 지역 기업만 신청 가능한 공고
- 이미 마감된 공고
- 지원 없는 단순 행사·교육·홍보
- 본문 근거가 부족해 공고 여부를 판단할 수 없는 탐색 메뉴

절대 추측하지 말고 제공된 본문에 있는 내용만 사용하세요. 날짜는 ISO 8601 형식으로, 알 수 없으면 null로 작성하세요.
지원내용은 카카오톡에 바로 쓸 수 있도록 각 항목을 "- "로 시작하는 짧은 문장으로 작성하세요.
priority는 중앙정부 10, 전국 20, 부산 30, 울산 35, 경남 40, 그 외 100을 기준으로 중요도를 반영하세요.

반환 형식:
{"programs":[{"index":0,"keep":true,"exclusionReason":"","applicantSummary":"- ...","supportSummary":"- ...","applicationMethod":"온라인 접수","startsAt":null,"deadlineAt":null,"regions":["전국"],"categories":["창업","사업화"],"priority":20}]}

후보:
${JSON.stringify(compact)}`) as { programs?: Array<Record<string, unknown>> };
  const rows = Array.isArray(result.programs) ? result.programs : [];
  return rows.flatMap((row): ProgramAnalysis[] => {
    const index = Number(row.index);
    const original = programs[index];
    if (!original) return [];
    return [{
      sourceKey: original.sourceKey,
      externalId: original.externalId,
      title: original.title,
      url: original.url,
      keep: row.keep === true,
      exclusionReason: String(row.exclusionReason || ""),
      applicantSummary: String(row.applicantSummary || "- 신청 대상은 공고문을 확인해 주세요."),
      supportSummary: String(row.supportSummary || "- 지원 내용은 공고문을 확인해 주세요."),
      applicationMethod: String(row.applicationMethod || original.applicationMethod || "접수방법은 공고문 참조"),
      startsAt: typeof row.startsAt === "string" ? row.startsAt : original.startsAt,
      deadlineAt: typeof row.deadlineAt === "string" ? row.deadlineAt : original.deadlineAt,
      regions: Array.isArray(row.regions) ? row.regions.map(String) : [],
      categories: Array.isArray(row.categories) ? row.categories.map(String) : [],
      priority: Math.max(1, Math.min(999, Number(row.priority) || 100)),
    }];
  });
}

async function verifiedUrls(urls: string[]) {
  const verified: string[] = [];
  for (const value of urls.slice(0, 4)) {
    try {
      const url = new URL(value);
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WoolimLinkChecker/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) verified.push(response.url || url.toString());
    } catch {
      // Unreachable links are intentionally omitted.
    }
  }
  return [...new Set(verified)];
}

type HistoryItem = {
  id: string;
  published_on: string | null;
  title: string;
  summary: string;
  keywords: string[];
};

export async function generateAfternoonContent({
  date,
  weekday,
  history,
}: {
  date: string;
  weekday: number;
  history: HistoryItem[];
}) {
  const theme = AFTERNOON_THEMES[weekday] || "대표자 실무 정보";
  const result = await askGemini(`울림컴퍼니 오픈채팅방에 올릴 오후 6시 콘텐츠 초안을 작성하세요.

오늘: ${date}
요일 테마: ${theme}
독자: 예비창업자, 소상공인, 중소기업 대표

규칙:
- 과거 게시물과 핵심 문제, 결론, 도구, 사이트가 겹치지 않는 새 주제를 선택합니다.
- 목요일에도 PDF나 단톡 배포자료를 만들지 말고 일반 정보 콘텐츠를 작성합니다.
- AI 말투를 줄이고 자연스러운 한국어 문단으로 연결합니다.
- 과도한 이모티콘과 과장된 표현을 피합니다.
- 주로 어디에 쓰이는지, 추천 이유, 활용 방법, 주의사항, 울림컴퍼니 팁을 포함합니다.
- 법률·세무·노무·정책 수치는 단정하지 말고 공식 확인 필요성을 명시합니다.
- 참고 링크는 실제 공식 사이트의 정확한 URL만 최대 3개 넣습니다.
- 상담 안내 문구는 시스템이 별도로 붙이므로 본문에 넣지 않습니다.
- 전체 분량은 카카오톡에서 읽기 좋은 900~1,500자입니다.

반환 형식:
{"title":"...","body":"...","referenceUrls":["https://..."],"keywords":["..."],"reason":"과거 글과 다른 이유"}

과거 게시물:
${JSON.stringify(history.map((item) => ({ date: item.published_on, title: item.title, keywords: item.keywords })).slice(0, 80))}`) as Record<string, unknown>;
  const draft = {
    title: String(result.title || "오늘의 울림 비즈니스 팁"),
    body: String(result.body || ""),
    referenceUrls: await verifiedUrls(Array.isArray(result.referenceUrls) ? result.referenceUrls.map(String) : []),
    keywords: Array.isArray(result.keywords) ? result.keywords.map(String).slice(0, 10) : [],
    reason: String(result.reason || ""),
  };
  const similarity = assessHistoricalSimilarity(draft, history.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    keywords: item.keywords,
  })));
  return { ...draft, theme, similarity };
}

