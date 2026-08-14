export const OPENCHAT_ROOM_NAME = "[울림컴퍼니]정부지원사업 정보 + 사업계획서 작성법";
/**
 * 하루에 내보낼 오전 공고 수.
 *
 * 열 건은 읽는 사람에게도 검토하는 사람에게도 많았습니다.
 * 넘치는 후보는 버리지 않고 다음 영업일로 넘깁니다.
 * 환경변수 OPENCHAT_MORNING_LIMIT 로 조정할 수 있습니다.
 */
export const MORNING_PROGRAM_LIMIT = 5;

/** 상세정보가 빠진 공고를 한 번에 손볼 최대 건수. 내보내는 수와는 별개입니다. */
export const MORNING_REPAIR_LIMIT = 10;

export function morningProgramLimit() {
  const value = Number(process.env.OPENCHAT_MORNING_LIMIT);
  return Number.isFinite(value) && value >= 1 && value <= 30
    ? Math.floor(value)
    : MORNING_PROGRAM_LIMIT;
}
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

