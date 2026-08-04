export const OPENCHAT_ROOM_NAME = "[울림컴퍼니]정부지원사업 정보 + 사업계획서 작성법";
export const MORNING_PROGRAM_LIMIT = 10;
export const NOVELTY_LOOKBACK_DAYS = 90;

export const CONSULTATION_FOOTER = `기업의 성장이 울림컴퍼니가 추구하는 최우선의 가치입니다.

울림컴퍼니 상담
📞 010-9522-0350
🔗 https://www.woolimcompany.kr/`;

export const AFTERNOON_THEMES: Record<number, string> = {
  0: "다음 주 준비와 실행 체크리스트",
  1: "정부지원사업 활용과 사업 운영",
  2: "AI·업무 생산성 도구",
  3: "마케팅·브랜딩·고객 행동",
  4: "대표자 실무 정보",
  5: "경영 인사이트·주말 생각거리",
  6: "예비창업자 기초 가이드",
};

export const PROGRAM_STATUS_LABELS = {
  collected: "수집됨",
  review_required: "검토 필요",
  approved: "승인",
  deferred: "다음 영업일 이월",
  excluded: "제외",
  ready: "게시 준비",
  published: "게시 완료",
} as const;

export const CONTENT_STATUS_LABELS = {
  topic_candidate: "주제 후보",
  review_required: "검토 필요",
  approved: "승인",
  deferred: "보류",
  ready: "게시 준비",
  published: "게시 완료",
  on_hold: "자동 검수 보류",
} as const;

