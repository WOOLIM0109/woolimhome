/**
 * 대표 썸네일에 쓸 장표 고르기
 *
 * 썸네일은 원본 PPT의 표지(1장)만 씁니다.
 * 예전에는 표지를 쓸 수 없으면 말없이 다른 장표로 바꿔치기했습니다.
 * 그러면 어느 문서인지 알아볼 수 없는 썸네일이 그대로 올라갑니다.
 *
 * 표지를 쓸 수 없으면 undefined 를 돌려주고, 부르는 쪽이 멈추고 사유를 남깁니다.
 */
export const PORTFOLIO_COVER_SLIDE_INDEX = 0;

export function resolveCoverIndex(eligibleSlideIndexes: Iterable<number>) {
  const eligible = eligibleSlideIndexes instanceof Set
    ? eligibleSlideIndexes
    : new Set(eligibleSlideIndexes);
  return eligible.has(PORTFOLIO_COVER_SLIDE_INDEX) ? PORTFOLIO_COVER_SLIDE_INDEX : undefined;
}
