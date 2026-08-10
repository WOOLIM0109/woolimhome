import { AFTERNOON_THEMES } from "./config";
import { assessHistoricalSimilarity } from "./novelty";
import type { CollectedProgram } from "./types";

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
  applicationPeriodText: string;
  startsAt?: string | null;
  deadlineAt?: string | null;
  regions: string[];
  categories: string[];
  priority: number;
};

function fallbackProgramAnalysis(program: CollectedProgram): ProgramAnalysis {
  const payload = program.sourcePayload || {};
  const title = program.title;
  const applicantText = program.applicantSummary || "";
  const otherPlace = /(서울|경기|인천|대전|대구|광주|세종|강원|충북|충남|전북|전남|경북|제주|구미|이천|하남|화성)/i;
  const directOtherRegion = new RegExp(`${otherPlace.source}(?:시|도)?\\s*(?:내|관내)?\\s*(?:소재|거주|주소|사업장|본사|이전)`, "i").test(applicantText);
  const regionalCenterRelocation = /(본점|주소지).{0,60}(센터|창업보육)|센터.{0,60}(본점|주소지)/i.test(applicantText)
    && !/(부산|울산|경남|창원|김해|양산|진주|거제|통영)/i.test(`${title} ${applicantText}`);
  const otherRegion = directOtherRegion || regionalCenterRelocation;
  const unsupportedEvent = /(시상|유공포상|아이디어\s*공모전|설명회|세미나|포럼)/.test(title)
    && !/(지원금|사업화|R&D|연구개발|바우처|정책자금|시제품)/i.test(title);
  const region = /부산/.test(title) || program.sourceKey.startsWith("busan") ? "부산"
    : /울산/.test(title) ? "울산"
      : /경남|창원/.test(title) ? "경남"
        : "전국";
  const applicant = program.applicantSummary || (typeof payload.sprtBizTrgtNm === "string" ? payload.sprtBizTrgtNm
    : typeof payload.applicantType === "string" ? payload.applicantType
      : "");
  const purpose = program.supportSummary || (typeof payload.txtDc === "string" ? payload.txtDc
    : typeof payload.category === "string" ? `${payload.category} 분야 지원`
      : "");
  const sourcePriority: Record<string, number> = {
    kstartup: 10,
    bizinfo: 15,
    busanstartup: 25,
    btp: 30,
    fanfandaero: 35,
  };
  return {
    sourceKey: program.sourceKey,
    externalId: program.externalId,
    title,
    url: program.url,
    keep: !otherRegion && !unsupportedEvent,
    exclusionReason: otherRegion ? "부울경 외 지역 한정 공고" : unsupportedEvent ? "지원 없는 행사·포상 공고" : "",
    applicantSummary: applicant ? `- ${applicant.replace(/^-\s*/, "")}` : "",
    supportSummary: purpose ? `- ${purpose.replace(/^-\s*/, "")}` : "",
    applicationMethod: program.applicationMethod || "",
    applicationPeriodText: program.applicationPeriodText || (payload.rcritEndChk === "Y" ? "-공고일로부터 예산 소진 시까지" : ""),
    startsAt: program.startsAt,
    deadlineAt: program.deadlineAt,
    regions: [region],
    categories: [],
    priority: sourcePriority[program.sourceKey] || (region === "전국" ? 50 : 40),
  };
}

export function analyzeProgramDeterministically(program: CollectedProgram) {
  return fallbackProgramAnalysis(program);
}

export async function analyzePrograms(programs: CollectedProgram[], options?: { useGoogleSearch?: boolean }) {
  void options;
  return programs.map(fallbackProgramAnalysis);
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

type FallbackTopic = {
  title: string;
  useCase: string;
  reason: string;
  steps: string[];
  caution: string;
  tip: string;
  referenceUrls: string[];
  keywords: string[];
};

const FALLBACK_TOPICS: Record<number, FallbackTopic> = {
  0: {
    title: "다음 주 업무를 가볍게 만드는 3대 우선순위",
    useCase: "새로운 한 주를 앞두고 해야 할 일이 많을 때, 매출·고객·운영 과제를 구분하는 데 활용합니다.",
    reason: "할 일의 개수보다 이번 주에 반드시 끝낼 결과를 먼저 정하면 돌발 업무가 생겨도 중심을 잃지 않습니다.",
    steps: ["매출과 직접 연결되는 일 1개를 고릅니다.", "고객 불편을 줄이는 일 1개를 고릅니다.", "반복 업무를 줄이는 개선 과제 1개를 고릅니다."],
    caution: "하루 단위 할 일까지 한꺼번에 적기보다, 주간 결과를 정한 뒤 일정표에 나누어 배치하세요.",
    tip: "세 가지 과제마다 완료 기준을 숫자나 산출물로 적으면 실행 여부를 금요일에 바로 판단할 수 있습니다.",
    referenceUrls: ["https://www.work24.go.kr/"],
    keywords: ["주간계획", "우선순위", "업무관리"],
  },
  1: {
    title: "지원사업 공고를 10분 안에 거르는 순서",
    useCase: "새 공고를 발견했을 때 우리 회사가 실제로 신청할 수 있는지 빠르게 판단하는 데 활용합니다.",
    reason: "지원금액만 먼저 보면 지역, 업력, 업종 제한을 뒤늦게 발견해 준비 시간을 낭비하기 쉽습니다.",
    steps: ["신청 지역과 업력 기준을 먼저 확인합니다.", "지원 제외 대상과 중복수혜 제한을 확인합니다.", "자부담, 제출서류, 마감 시각을 한 줄로 정리합니다."],
    caution: "요약 게시물은 탐색용입니다. 최종 신청 판단은 반드시 원문 공고문과 첨부파일을 기준으로 하세요.",
    tip: "조건 충족, 보완 필요, 신청 제외 세 칸으로 나누면 여러 공고를 비교하기 쉬워집니다.",
    referenceUrls: ["https://www.bizinfo.go.kr/", "https://www.k-startup.go.kr/"],
    keywords: ["지원사업", "공고검토", "체크리스트"],
  },
  2: {
    title: "AI 답변을 업무에 쓰기 전 확인할 4가지",
    useCase: "시장조사 요약, 제안서 초안, 고객 안내문처럼 AI가 만든 내용을 실제 업무에 반영하기 전에 활용합니다.",
    reason: "AI는 그럴듯한 문장을 빠르게 만들지만 출처, 최신성, 숫자, 개인정보까지 자동으로 보증하지는 않습니다.",
    steps: ["숫자와 날짜는 원문 출처에서 다시 확인합니다.", "법률·세무·지원제도는 공식 사이트의 최신 공고와 대조합니다.", "회사명, 고객정보, 계약내용 같은 민감정보가 포함됐는지 점검합니다.", "최종 문장을 우리 고객이 이해할 표현으로 다시 다듬습니다."],
    caution: "출처가 표시되지 않은 통계나 지원조건은 그대로 전달하지 말고 ‘공식 확인 필요’라고 구분하세요.",
    tip: "AI에게 답을 다시 묻기보다 ‘확인이 필요한 사실만 표로 분리해 줘’라고 요청하면 검수 시간이 줄어듭니다.",
    referenceUrls: ["https://www.privacy.go.kr/", "https://www.law.go.kr/"],
    keywords: ["AI검수", "팩트체크", "개인정보", "업무자동화"],
  },
  3: {
    title: "고객 문의를 매출 자료로 바꾸는 분류법",
    useCase: "전화, 채팅, 댓글로 반복되는 고객 질문을 상품 개선과 콘텐츠 기획에 활용합니다.",
    reason: "반복 질문은 고객이 구매 전에 느끼는 불안과 정보 부족을 보여주는 가장 가까운 자료입니다.",
    steps: ["문의 내용을 가격·기능·배송·신뢰·사용법으로 분류합니다.", "일주일 동안 반복 횟수를 기록합니다.", "가장 많은 질문부터 상세페이지와 안내문에 반영합니다."],
    caution: "고객 이름과 연락처는 분석표에서 제외하고 문의 내용만 익명으로 정리하세요.",
    tip: "답변 시간을 줄이는 것보다 질문 자체가 생기지 않도록 판매 페이지를 고치는 것이 먼저입니다.",
    referenceUrls: ["https://www.privacy.go.kr/"],
    keywords: ["고객문의", "VOC", "매출", "상세페이지"],
  },
  4: {
    title: "사업용 증빙을 매주 15분으로 끝내는 방법",
    useCase: "대표자가 카드전표, 세금계산서, 계좌이체 내역을 월말에 한꺼번에 찾는 상황을 줄이는 데 활용합니다.",
    reason: "증빙을 거래 직후 분류하면 누락을 줄이고 세무대리인에게 전달할 자료도 선명해집니다.",
    steps: ["사업용 계좌와 카드를 개인 용도와 분리합니다.", "매주 같은 요일에 미확인 거래만 점검합니다.", "거래 목적을 한 줄 메모하고 증빙 파일명을 날짜와 거래처로 통일합니다."],
    caution: "비용 인정 여부와 증빙 기준은 거래 성격에 따라 달라질 수 있으므로 국세청 또는 세무전문가에게 확인하세요.",
    tip: "파일을 많이 모으는 것보다 ‘누가, 왜, 어떤 사업을 위해 썼는지’를 설명할 수 있게 만드는 것이 중요합니다.",
    referenceUrls: ["https://www.hometax.go.kr/"],
    keywords: ["증빙", "세무", "사업용계좌", "경비관리"],
  },
  5: {
    title: "재구매를 부르는 판매 후 7일 관리",
    useCase: "상품이나 서비스를 판매한 뒤 고객 경험을 확인하고 후기와 재구매로 연결할 때 활용합니다.",
    reason: "판매 직후의 작은 불편을 먼저 발견하면 불만이 커지는 것을 막고 다음 상품 개선 자료도 얻을 수 있습니다.",
    steps: ["이용 시작에 필요한 안내를 판매 직후 전달합니다.", "3일 안에 사용 중 불편 여부를 묻습니다.", "7일째에는 만족한 지점과 개선 의견을 짧게 요청합니다."],
    caution: "반복적인 광고 메시지나 수신 동의 없는 홍보 발송은 피하고 필요한 안내 중심으로 운영하세요.",
    tip: "후기를 부탁하기 전에 고객이 결과를 얻었는지 먼저 확인하면 응답의 질이 달라집니다.",
    referenceUrls: ["https://www.kca.go.kr/"],
    keywords: ["재구매", "고객관리", "후기", "사후관리"],
  },
  6: {
    title: "대표의 주간 회고를 남기는 세 문장",
    useCase: "한 주의 매출과 업무를 돌아보되 긴 보고서를 쓸 시간이 없을 때 활용합니다.",
    reason: "짧은 기록이 쌓이면 감으로 내린 결정과 실제 결과의 차이를 확인할 수 있습니다.",
    steps: ["이번 주 가장 잘한 선택을 한 문장으로 씁니다.", "예상과 달랐던 결과를 한 문장으로 씁니다.", "다음 주에 멈추거나 바꿀 행동을 한 문장으로 씁니다."],
    caution: "성과를 평가하는 데 그치지 말고 다음 행동이 달라지도록 구체적으로 적으세요.",
    tip: "매출 숫자 하나와 고객 반응 하나를 함께 기록하면 다음 달 의사결정 자료로 쓰기 좋습니다.",
    referenceUrls: ["https://www.sbiz24.kr/"],
    keywords: ["주간회고", "의사결정", "경영기록"],
  },
};

function fallbackAfternoonContent(weekday: number) {
  const topic = FALLBACK_TOPICS[weekday] || FALLBACK_TOPICS[4];
  const body = `📌 오늘의 울림 비즈니스 팁

[${topic.title}]

어디에 쓰이나요?
${topic.useCase}

왜 필요한가요?
${topic.reason}

실무 적용 순서
${topic.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

주의할 점
${topic.caution}

💡 울림컴퍼니 팁
${topic.tip}`;
  return {
    title: topic.title,
    body,
    referenceUrls: topic.referenceUrls,
    keywords: topic.keywords,
    reason: "Gemini 비용 보호 모드에서 결정론적 대체 초안을 사용했습니다.",
  };
}

export async function generateAfternoonContent({
  weekday,
  history,
}: {
  date: string;
  weekday: number;
  history: HistoryItem[];
}) {
  const theme = AFTERNOON_THEMES[weekday] || "대표자 실무 정보";
  const result = fallbackAfternoonContent(weekday);
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
