/**
 * 대표 썸네일에 쓸 장표 고르기
 *
 * 원칙은 하나입니다. 썸네일은 원본 PPT의 표지(1장)를 씁니다.
 *
 * 주의할 점이 하나 있습니다.
 * 워커는 변환하지 못한 장표를 건너뛰고 남은 것만 0번부터 다시 번호를 매깁니다.
 * 표지가 건너뛰어지면 0번은 표지가 아니라 그 다음 장표가 됩니다.
 * 그래서 번호가 아니라 원본 장표 번호(sourceSlideNumber)가 1인 것을 찾습니다.
 *
 * 표지를 못 쓰는 경우가 실제로 있습니다.
 *   · 워커가 표지를 변환하지 못한 경우
 *   · 표지의 가림 면적이 너무 넓어 자동 디자인에서 제외된 경우
 *
 * 예전에는 이럴 때 아무 장표나 말없이 갖다 썼습니다. 어느 문서인지 알 수 없는
 * 썸네일이 조용히 올라가는 문제가 있었습니다.
 * 그렇다고 아예 멈춰 세우면 작업 전체가 얼어붙습니다. 실제로 두 건이 그렇게 멈췄습니다.
 *
 * 그래서 지금은 대신 쓴 사실을 분명히 남깁니다.
 * 다음 장표로 이어서 만들되, 화면에 "표지를 못 써서 대신 썼다"고 알리고
 * 관리자가 표지 이미지를 직접 올릴 수 있게 합니다.
 */
export const PORTFOLIO_COVER_SOURCE_SLIDE_NUMBER = 1;

export type CoverSlideCandidate = {
  slideIndex: number;
  sourceSlideNumber: number;
};

export type CoverSlideBlockedReason = "not_converted" | "redaction_excluded";

export type CoverSlideResolution = {
  coverIndex: number | undefined;
  /** 표지를 못 쓴 이유. 표지를 그대로 썼으면 null 입니다. */
  blockedReason: CoverSlideBlockedReason | null;
  /** 표지 대신 쓴 장표의 원본 번호. 표지를 썼으면 null 입니다. */
  substitutedSourceSlideNumber: number | null;
};

export function resolveCoverSlide(input: {
  /** 변환된 장표 목록. 기록이 없으면 번호 0번을 표지로 봅니다. */
  slides?: CoverSlideCandidate[] | null;
  eligibleSlideIndexes: Iterable<number>;
}): CoverSlideResolution {
  const eligible = input.eligibleSlideIndexes instanceof Set
    ? input.eligibleSlideIndexes
    : new Set(input.eligibleSlideIndexes);

  /** 표지를 못 쓸 때 쓸 다음 장표를 고릅니다. 앞쪽 장표일수록 문서를 잘 보여 줍니다. */
  const firstUsable = (slides: CoverSlideCandidate[] | null | undefined) => {
    const ordered = [...(slides || [])].sort(
      (left, right) => left.sourceSlideNumber - right.sourceSlideNumber,
    );
    return ordered.find((slide) => eligible.has(slide.slideIndex)) || null;
  };

  if (!input.slides || !input.slides.length) {
    // 예전 방식으로 만든 작업에는 원본 장표 번호 기록이 없습니다.
    if (eligible.has(0)) {
      return { coverIndex: 0, blockedReason: null, substitutedSourceSlideNumber: null };
    }
    const fallbackIndex = [...eligible].sort((left, right) => left - right)[0];
    return fallbackIndex === undefined
      ? { coverIndex: undefined, blockedReason: "redaction_excluded", substitutedSourceSlideNumber: null }
      : {
        coverIndex: fallbackIndex,
        blockedReason: "redaction_excluded",
        substitutedSourceSlideNumber: fallbackIndex + 1,
      };
  }

  const cover = input.slides.find(
    (slide) => slide.sourceSlideNumber === PORTFOLIO_COVER_SOURCE_SLIDE_NUMBER,
  );
  if (cover && eligible.has(cover.slideIndex)) {
    return { coverIndex: cover.slideIndex, blockedReason: null, substitutedSourceSlideNumber: null };
  }

  const reason: CoverSlideBlockedReason = cover ? "redaction_excluded" : "not_converted";
  const replacement = firstUsable(input.slides);
  if (!replacement) {
    return { coverIndex: undefined, blockedReason: reason, substitutedSourceSlideNumber: null };
  }
  return {
    coverIndex: replacement.slideIndex,
    blockedReason: reason,
    substitutedSourceSlideNumber: replacement.sourceSlideNumber,
  };
}

/** 표지를 못 썼을 때 화면에 보여 줄 안내 문구입니다. */
export function coverSlideSubstitutionNotice(
  reason: CoverSlideBlockedReason,
  sourceSlideNumber: number,
) {
  const cause = reason === "not_converted"
    ? "원본 PPT의 표지(1장)를 변환하지 못해"
    : "원본 PPT의 표지(1장)가 가림 면적이 너무 넓어 자동 디자인에서 제외되어";
  return `${cause} ${sourceSlideNumber}번 장표를 대표 이미지로 썼습니다.`
    + " 표지를 쓰려면 아래 '이미지 직접 올리기'에서 대표 썸네일을 넣어 주세요.";
}

/** 쓸 수 있는 장표가 하나도 없을 때의 문구입니다. */
export function coverSlideBlockedMessage(reason: CoverSlideBlockedReason) {
  return reason === "not_converted"
    ? "원본 PPT의 표지(1장)가 변환되지 않았고, 대신 쓸 장표도 없어 대표 썸네일을 만들 수 없습니다."
    : "가림 검사를 통과한 장표가 하나도 없어 대표 썸네일을 만들 수 없습니다.";
}
