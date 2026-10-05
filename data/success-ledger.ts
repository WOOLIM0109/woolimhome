export type SuccessTrack = "funding" | "bidding" | "investment" | "entry" | "certification" | "award";

export type SuccessRecord = {
  id: string;
  year: number | null;
  program: string;
  customerId: string;
  company: string;
  track: SuccessTrack;
  stage: "screening" | "final";
  amountWon: number;
  publicApproved: boolean;
};

// 금액은 원 단위. 연도가 확인되지 않은 실적은 null로 남깁니다.
const funding: Array<[string, number, string, string, string, number]> = [
  ["leathers-prestartup", 2023, "예비창업패키지", "leathers", "들레더스", 40_000_000],
  ["sports-startup", 2024, "스포츠산업 예비초기창업 (승마안장)", "equestrian", "승마용품 제조 기업", 40_000_000],
  ["regional-arts", 2024, "문체부 지역대표예술단체", "yeosu-symphony", "여수심포니오케스트라", 600_000_000],
  ["youth-academy", 2025, "청년창업사관학교", "linematics", "라인매틱스", 70_000_000],
  ["wposition-startup", 2025, "초기창업패키지", "wposition", "더블유포지션", 70_000_000],
  ["wposition-data", 2025, "데이터가공 지원사업", "wposition", "더블유포지션", 55_000_000],
  ["nest", 2025, "신용보증기금 스타트업 NEST", "anymath-ai", "애니매쓰AI", 100_000_000],
  ["wposition-export", 2025, "테크서비스 수출바우처", "wposition", "더블유포지션", 30_000_000],
  ["wposition-rise", 2025, "계명대 RISE 산학공동연구", "wposition", "더블유포지션", 30_000_000],
  ["wposition-tips", 2026, "TIPS", "wposition", "더블유포지션", 800_000_000],
  ["wposition-city", 2026, "창업도시조성 투자연계형(도약)", "wposition", "더블유포지션", 150_000_000],
  ["ogu-marketing", 2026, "부산 커피산업 R&D 클러스터 (마케팅)", "ogu", "오구", 13_000_000],
  ["ogu-exhibition", 2026, "부산 커피산업 R&D 클러스터 (전시회)", "ogu", "오구", 10_000_000],
  ["high-risk", 2026, "고위험산업 사각지대 집중관리", "cheonma-gas", "천마가스", 12_000_000],
  ["altro-ai", 2026, "AI혁신 소상공인", "cafe-altro", "카페알트로", 10_000_000],
  ["ogu-coffee", 2026, "커피산업 기반조성 및 기업육성", "ogu", "오구", 8_890_000],
  ["altro-ip", 2026, "부산 긴급지식재산", "cafe-altro", "카페알트로", 2_200_000],
  ["altro-content", 2026, "판판대로 콘텐츠제작 (콘텐츠 제작 지원사업 4차)", "cafe-altro", "카페알트로", 2_500_000],
  ["wposition-dtech", 2026, "D-TECH 프로그램 2차", "wposition", "더블유포지션", 60_000_000],
  ["samwoo-ai", 2026, "소상공인 혁신 AI 활용", "samwoo", "삼우물산", 24_000_000],
  ["ellien-ai", 2026, "소상공인 혁신 AI 활용", "ellien", "엘리앤코스파", 16_000_000],
  ["selavento-startup", 2026, "모두의창업 1기 1R", "selavento", "셀라벤토 (자사)", 3_000_000],
  ["el-startup", 2026, "모두의창업 2기 1R", "el-group", "이엘그룹", 3_000_000],
];

const bidding: Array<[string, string, string, string, number]> = [
  ["cj-si", "CJ올리브네트웍스 SI 용역", "mirae", "미래아이엔텍", 1_100_000_000],
  ["district-waste-service", "부산 금정구 1구역 폐기물 수집·처리", "hyundai", "현대실업", 1_000_000_000],
  ["career-education-program", "원격영상 진로멘토링 기획수업 운영", "awesome", "어썸", 350_000_000],
  ["local-festival", "광양 시민의 날 개최", "individual", "개인 의뢰", 100_000_000],
  ["facility-waterproofing", "문현아파트 방수·페인트", "woori-paint", "우리페인트", 100_000_000],
];

const entries: Array<[string, string, string, string]> = [
  ["daiso-homeplus", "다이소@홈플러스 상봉점 입점", "retail", "유통 기업"],
  ["cj-live-commerce", "CJ온스타일 협업", "lolsy", "롤시"],
  ["musinsa-entry", "무신사 입점", "urbanis", "어반이즈"],
  ["hyundai-capital", "현대캐피탈 제휴", "mobility-plus", "모빌리티플러스"],
  ["kakao-gift-entry", "카카오 선물하기 입점", "lolsy", "롤시"],
  ["the-hyundai-popup", "더현대 강남 팝업 입점", "popup-brands", "블루말레·세이블스"],
];

const SUCCESS_LEDGER: readonly SuccessRecord[] = [
  ...funding.map(([id, year, program, customerId, company, amountWon]): SuccessRecord =>
    ({ id, year, program, customerId, company, amountWon, track: "funding", stage: "final", publicApproved: true })),
  ...bidding.map(([id, program, customerId, company, amountWon]): SuccessRecord =>
    ({ id, year: 2024, program, customerId, company, amountWon, track: "bidding", stage: "final", publicApproved: true })),
  { id: "wposition-investment", year: null, program: "TIPS 추천을 위한 IR 투자유치", customerId: "wposition", company: "더블유포지션", amountWon: 200_000_000, track: "investment", stage: "final", publicApproved: true },
  ...entries.map(([id, program, customerId, company]): SuccessRecord =>
    ({ id, year: null, program, customerId, company, amountWon: 0, track: "entry", stage: "final", publicApproved: true })),
  { id: "eve-venture", year: 2023, program: "벤처인증 완료", customerId: "eve-electronic", company: "이브일렉트로닉스", amountWon: 0, track: "certification", stage: "final", publicApproved: true },
  { id: "rensys-sandbox", year: 2024, program: "규제 샌드박스 실증계획서 선정", customerId: "rensys", company: "렌시스코리아", amountWon: 0, track: "certification", stage: "final", publicApproved: true },
  { id: "wposition-dash", year: 2024, program: "DASH 입주 선정 (2024.11)", customerId: "wposition", company: "더블유포지션", amountWon: 0, track: "certification", stage: "final", publicApproved: true },
  { id: "hana-permit", year: 2023, program: "공공 수주 · 출입국관리 외국인 법인 허가", customerId: "hana", company: "하나법무회계법인", amountWon: 0, track: "certification", stage: "final", publicApproved: true },
  { id: "dreamwings-job", year: 2023, program: "공공 수주 · 취업날개서비스", customerId: "dreamwings", company: "드림윙즈", amountWon: 0, track: "certification", stage: "final", publicApproved: true },
  { id: "sleep-tech-screening", year: null, program: "창업성장기술개발 디딤돌 1차 서류합격", customerId: "sleep-tech", company: "수면테크 앱 기업", amountWon: 200_000_000, track: "funding", stage: "screening", publicApproved: false },
  { id: "leathers-screening", year: null, program: "청년창업사관학교 1차 합격", customerId: "leathers", company: "들레더스", amountWon: 70_000_000, track: "funding", stage: "screening", publicApproved: false },
];

// 향후 게시판 DB로 교체할 단일 접근점. 배열 자체는 외부에 공개하지 않습니다.
export async function getSuccessLedger(): Promise<readonly SuccessRecord[]> {
  return SUCCESS_LEDGER.map((record) => ({ ...record }));
}
