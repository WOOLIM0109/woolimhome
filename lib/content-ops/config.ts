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
  { key: "consult-tue", channel: "naver_consulting", format: "authority", weekday: 2, hour: 14, label: "울림 콘텐츠형" },
  { key: "consult-wed", channel: "naver_consulting", format: "informational", weekday: 3, hour: 10, label: "정보형" },
  { key: "consult-thu", channel: "naver_consulting", format: "authority", weekday: 4, hour: 14, label: "울림 콘텐츠형" },
  { key: "consult-fri", channel: "naver_consulting", format: "informational", weekday: 5, hour: 10, label: "정보형" },
  { key: "design-tue", channel: "naver_design", format: "portfolio", weekday: 2, hour: 11, label: "포트폴리오" },
  { key: "design-thu", channel: "naver_design", format: "design_insight", weekday: 4, hour: 11, label: "기획·디자인 콘텐츠" },
  { key: "design-fri", channel: "naver_design", format: "portfolio", weekday: 5, hour: 11, label: "포트폴리오" },
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
