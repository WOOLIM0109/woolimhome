import type { ContentChannel, EditorialSlot, WorkflowStatus } from "./types";

export const CHANNELS: {
  value: ContentChannel;
  label: string;
  shortLabel: string;
  href: string;
  description: string;
}[] = [
  {
    value: "homepage",
    label: "홈페이지 칼럼",
    shortLabel: "홈페이지",
    href: "/admin/columns",
    description: "공식자료와 울림 노하우를 결합한 심층 콘텐츠",
  },
  {
    value: "naver_consulting",
    label: "컨설팅 블로그",
    shortLabel: "컨설팅",
    href: "/admin/naver-consulting",
    description: "검색 유입용 정보와 울림의 경영 전문성을 함께 관리",
  },
  {
    value: "naver_design",
    label: "디자인 블로그",
    shortLabel: "디자인",
    href: "/admin/naver-design",
    description: "포트폴리오와 기획·디자인 콘텐츠를 함께 관리",
  },
];

export const CONSULTING_TOPIC_FAMILIES = [
  "경영전략·사업기획",
  "기업인증·제품인증·해외인증",
  "정부지원사업·R&D",
  "정책자금·융자·투자유치",
  "창업·법인설립",
  "사업계획서·IR",
  "조직·업무체계",
  "마케팅·영업",
  "재무·수익구조",
  "수출·해외진출",
  "기술사업화·지식재산",
  "조달·입찰·공공시장",
  "위기관리·문제해결",
  "업종별 경영 이슈",
  "컨설팅 사례·대표자 인터뷰",
];

export const EDITORIAL_SLOTS: EditorialSlot[] = [
  { key: "home-tue", channel: "homepage", format: "informational", weekday: 2, hour: 10, label: "정보형 칼럼" },
  { key: "home-thu", channel: "homepage", format: "column", weekday: 4, hour: 10, label: "하이브리드 칼럼" },
  { key: "home-sat", channel: "homepage", format: "authority", weekday: 6, hour: 10, label: "격주 노하우 칼럼" },
  { key: "consult-mon", channel: "naver_consulting", format: "informational", weekday: 1, hour: 10, label: "정보형" },
  { key: "consult-tue", channel: "naver_consulting", format: "authority", weekday: 2, hour: 10, label: "울림 콘텐츠형" },
  { key: "consult-wed", channel: "naver_consulting", format: "informational", weekday: 3, hour: 10, label: "정보형" },
  { key: "consult-thu", channel: "naver_consulting", format: "authority", weekday: 4, hour: 10, label: "울림 콘텐츠형" },
  { key: "consult-fri", channel: "naver_consulting", format: "informational", weekday: 5, hour: 10, label: "정보형" },
  { key: "design-tue", channel: "naver_design", format: "portfolio", weekday: 2, hour: 9, label: "포트폴리오" },
  { key: "design-thu", channel: "naver_design", format: "design_insight", weekday: 4, hour: 9, label: "기획·디자인 콘텐츠" },
  { key: "design-fri", channel: "naver_design", format: "portfolio", weekday: 5, hour: 9, label: "포트폴리오" },
];

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  topic_candidate: "주제 후보",
  researching: "자료 조사",
  creating: "제작 중",
  review_required: "검토 필요",
  approved: "승인 완료",
  naver_ready: "네이버 입력 대기",
  scheduled: "예약 완료",
  published: "발행 완료",
  on_hold: "보류",
};

export const STATUS_STYLES: Record<WorkflowStatus, string> = {
  topic_candidate: "bg-stone-100 text-stone-700",
  researching: "bg-blue-50 text-blue-800",
  creating: "bg-violet-50 text-violet-800",
  review_required: "bg-amber-50 text-amber-900",
  approved: "bg-emerald-50 text-emerald-800",
  naver_ready: "bg-cyan-50 text-cyan-800",
  scheduled: "bg-indigo-50 text-indigo-800",
  published: "bg-green-50 text-green-800",
  on_hold: "bg-red-50 text-red-800",
};

/**
 * 컨설팅 정보형 글의 주제 유형과 실제 예시.
 *
 * 공식 출처가 지원사업·정책자금 쪽에 몰려 있어서, 후보가 매번 그쪽으로만 쏠렸습니다.
 * 실제 블로그에는 서류 발급 방법이나 시스템 사용법 같은 글이 훨씬 많이 있고,
 * 검색 유입도 그런 글에서 꾸준히 나옵니다.
 * 아래 목록은 그 결을 알려 주는 참고 예시입니다. 그대로 베끼지 않고 결만 참고합니다.
 */
export const CONSULTING_INFORMATIONAL_TOPIC_TYPES = [
  {
    type: "증명서·서류 발급 방법",
    examples: [
      "사업자등록증명 발급방법 정부지원사업 준비서류 정리",
      "4대보험 완납증명서 발급방법 정부지원사업 준비서류",
      "법인인감증명서 발급 방법 정부지원사업 계약 및 협약 전 필수 확인",
      "지방세 세목별 과세증명서 발급방법 정부24·위택스로 5분 만에",
      "근로소득 원천징수영수증 발급방법 회사에 안 물어도 되는 방법",
    ],
  },
  {
    type: "온라인 시스템 사용법",
    examples: [
      "사업자등록 업종코드 추가 방법, 홈택스에서 5분 만에 해결하기",
      "소득금액증명원 인터넷 발급방법 총정리 홈택스·정부24",
      "R&D 과제 준비 전 SMTECH 기관등록 방법부터 확인하세요",
      "국가연구자 번호 조회 방법",
    ],
  },
  {
    type: "헷갈리는 용어·제도 구분",
    examples: [
      "R&D 공고에서 자주 나오는 주관기관·참여기관·위탁기관 차이 정리",
      "정책자금 vs 정부지원사업, 우리 회사는 무엇부터 준비할까",
      "기업부설연구소와 연구개발전담부서 차이점 확인하기",
    ],
  },
  {
    type: "제출서류 준비·유효기간 관리",
    examples: [
      "정부지원사업 제출서류 유효기간 이것만은 꼭 체크하세요",
      "중소기업확인서 발급방법 및 유효기간 정리",
      "창업기업확인서 발급 방법 확인해야 할 필수조건",
    ],
  },
  {
    type: "자주 막히는 오류 해결",
    examples: [
      "정부24 PDF 저장 인쇄 출력 불가 할 경우 해결하는 법",
      "사업자등록증 주소변경 방법, 홈택스에서 어떻게 해야 할까",
    ],
  },
  {
    type: "지원사업·정책자금 안내",
    examples: [
      "부산 소상공인 및 벤처기업 대상 비즈니스지원단 현장클리닉 활용법",
      "대전시 생산자금 활용법",
    ],
  },
] as const;
