/**
 * 대표 썸네일에 쓸 장표 고르기
 *
 * 썸네일은 원본 PPT의 표지(1장)만 씁니다.
 *
 * 주의할 점이 하나 있습니다.
 * 워커는 변환하지 못한 장표를 건너뛰고 남은 것만 0번부터 다시 번호를 매깁니다.
 * 표지가 건너뛰어지면 0번은 표지가 아니라 그 다음 장표가 됩니다.
 * 그래서 번호가 아니라 원본 장표 번호(sourceSlideNumber)가 1인 것을 찾습니다.
 *
 * 표지를 쓸 수 없으면 undefined 를 돌려주고, 부르는 쪽이 멈추고 사유를 남깁니다.
 * 다른 장표로 바꿔치기하면 어느 문서인지 알 수 없는 썸네일이 조용히 올라갑니다.
 */
export const PORTFOLIO_COVER_SOURCE_SLIDE_NUMBER = 1;

export type CoverSlideCandidate = {
  slideIndex: number;
  sourceSlideNumber: number;
};

export type CoverSlideResolution = {
  coverIndex: number | undefined;
  /** 표지를 못 쓰는 이유. 쓸 수 있으면 null 입니다. */
  blockedReason: "not_converted" | "redaction_excluded" | null;
};

export function resolveCoverSlide(input: {
  /** 변환된 장표 목록. 기록이 없으면 번호 0번을 표지로 봅니다. */
  slides?: CoverSlideCandidate[] | null;
  eligibleSlideIndexes: Iterable<number>;
}): CoverSlideResolution {
  const eligible = input.eligibleSlideIndexes instanceof Set
    ? input.eligibleSlideIndexes
    : new Set(input.eligibleSlideIndexes);

  if (!input.slides || !input.slides.length) {
    // 예전 방식으로 만든 작업에는 원본 장표 번호 기록이 없습니다.
    return eligible.has(0)
      ? { coverIndex: 0, blockedReason: null }
      : { coverIndex: undefined, blockedReason: "redaction_excluded" };
  }

  const cover = input.slides.find(
    (slide) => slide.sourceSlideNumber === PORTFOLIO_COVER_SOURCE_SLIDE_NUMBER,
  );
  if (!cover) return { coverIndex: undefined, blockedReason: "not_converted" };
  if (!eligible.has(cover.slideIndex)) {
    return { coverIndex: undefined, blockedReason: "redaction_excluded" };
  }
  return { coverIndex: cover.slideIndex, blockedReason: null };
}

export function coverSlideBlockedMessage(reason: "not_converted" | "redaction_excluded") {
  return reason === "not_converted"
    ? "원본 PPT의 표지(1장)가 변환되지 않아 대표 썸네일을 만들 수 없습니다. PC 워커 기록을 확인해 주세요."
    : "원본 PPT의 표지(1장)가 가림 검사에서 제외되어 대표 썸네일을 만들 수 없습니다. 표지의 가림 범위를 확인해 주세요.";
}
