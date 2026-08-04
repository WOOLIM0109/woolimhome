export type SlideAspect = "16:9" | "4:3" | "a4_landscape" | "a4_portrait" | "unknown";

export type PortfolioMockupMode = "insufficient" | "short" | "long";

export type SlideDimensions = {
  width: number;
  height: number;
};

export type SlideAspectClassification = {
  aspect: SlideAspect;
  ratio: number | null;
  relativeError: number | null;
  confidence: number;
};

export type SlideSelectionAssessment = {
  slideIndex: number;
  diagramRichness?: number | null;
  visualQuality?: number | null;
  rarity?: number | null;
  sectionDiversity?: number | null;
  /** Legacy visual-review score. Used when visualQuality is absent. */
  quality?: number | null;
  recommended?: boolean | null;
  role?: string | null;
  reason?: string | null;
  section?: string | number | null;
  sectionKey?: string | number | null;
  /** Stable identifiers supplied by image/layout analysis. */
  similarityKey?: string | null;
  layoutSignature?: string | null;
  /** Legacy/current visual-review name for a layout signature. */
  visualSignature?: string | null;
  visualHash?: string | null;
};

export type SlideScoreComponents = {
  diagramRichness: number;
  visualQuality: number;
  rarity: number;
  sectionDiversity: number;
};

export type ScoredSlide = {
  slideIndex: number;
  totalScore: number;
  components: SlideScoreComponents;
  reason: string;
  rank?: number;
};

export type ExcludedDuplicate = {
  slideIndex: number;
  keptSlideIndex: number;
  reason: string;
};

export type SlideSelectionResult = {
  mode: PortfolioMockupMode;
  selectedSlideIndexes: number[];
  selectedSlides: ScoredSlide[];
  excludedDuplicates: ExcludedDuplicate[];
};

export type SlideSelectionInput = {
  slideCount: number;
  assessments?: readonly SlideSelectionAssessment[] | null;
  shortLimit?: number;
  longLimit?: number;
};

const ASPECT_TARGETS: ReadonlyArray<{ aspect: Exclude<SlideAspect, "unknown">; ratio: number }> = [
  { aspect: "16:9", ratio: 16 / 9 },
  { aspect: "4:3", ratio: 4 / 3 },
  { aspect: "a4_landscape", ratio: 297 / 210 },
  { aspect: "a4_portrait", ratio: 210 / 297 },
];

const DEFAULT_ASPECT_TOLERANCE = 0.025;

export const SLIDE_SELECTION_WEIGHTS = Object.freeze({
  diagramRichness: 0.4,
  visualQuality: 0.3,
  rarity: 0.2,
  sectionDiversity: 0.1,
});

export const SLIDE_SELECTION_LIMITS = Object.freeze({ short: 14, long: 30 });
export const SLIDE_SELECTION_MINIMUM_SCORE = 50;
export const SIX_GRID_GROUP_COUNT = 5;
export const SIX_GRID_GROUP_SIZE = 6;
export const SIX_GRID_MINIMUM_GROUP_COUNT = 3;

function rounded(value: number, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function finiteRatio(input: number | SlideDimensions) {
  const ratio = typeof input === "number"
    ? input
    : Number(input.width) / Number(input.height);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * Classifies rendered slides without assuming every landscape page is 16:9.
 * A tight tolerance deliberately leaves Letter/custom pages as unknown rather
 * than stretching them into the nearest supported template.
 */
export function inspectSlideAspect(
  input: number | SlideDimensions,
  tolerance = DEFAULT_ASPECT_TOLERANCE,
): SlideAspectClassification {
  const ratio = finiteRatio(input);
  const safeTolerance = Number.isFinite(tolerance) && tolerance > 0
    ? tolerance
    : DEFAULT_ASPECT_TOLERANCE;
  if (ratio === null) {
    return { aspect: "unknown", ratio: null, relativeError: null, confidence: 0 };
  }

  const nearest = ASPECT_TARGETS
    .map((target) => ({
      ...target,
      relativeError: Math.abs(ratio - target.ratio) / target.ratio,
    }))
    .sort((left, right) => left.relativeError - right.relativeError)[0];

  if (!nearest || nearest.relativeError > safeTolerance) {
    return {
      aspect: "unknown",
      ratio,
      relativeError: nearest ? rounded(nearest.relativeError, 4) : null,
      confidence: 0,
    };
  }

  return {
    aspect: nearest.aspect,
    ratio,
    relativeError: rounded(nearest.relativeError, 4),
    confidence: rounded(1 - nearest.relativeError / safeTolerance, 4),
  };
}

export function classifySlideAspect(input: number | SlideDimensions): SlideAspect {
  return inspectSlideAspect(input).aspect;
}

export function portfolioMockupMode(slideCount: number): PortfolioMockupMode {
  const count = Number.isFinite(slideCount) ? Math.max(0, Math.floor(slideCount)) : 0;
  if (count < 5) return "insufficient";
  return count < 20 ? "short" : "long";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

/** Gemini and legacy portfolio review prompts both use an explicit 0..100 scale. */
function normalizedScore(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return clampScore(number);
}

export function buildSixGridGroups(indexes: readonly number[]) {
  const unique = [...new Set(indexes.filter((value) => Number.isInteger(value) && value >= 0))];
  if (unique.length < SIX_GRID_GROUP_SIZE * SIX_GRID_MINIMUM_GROUP_COUNT) return [];
  const groupCount = Math.min(SIX_GRID_GROUP_COUNT, Math.floor(unique.length / SIX_GRID_GROUP_SIZE));
  return Array.from({ length: groupCount }, (_, groupIndex) => (
    unique.slice(groupIndex * SIX_GRID_GROUP_SIZE, (groupIndex + 1) * SIX_GRID_GROUP_SIZE)
  ));
}

export function shortMockupRankedIndexes(
  selection: Pick<SlideSelectionResult, "selectedSlides">,
  capacity: number,
) {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  return [...selection.selectedSlides]
    .sort((left, right) => (
      (left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER)
      || right.totalScore - left.totalScore
      || left.slideIndex - right.slideIndex
    ))
    .slice(0, safeCapacity)
    .map((slide) => slide.slideIndex)
    .sort((left, right) => left - right);
}

function assessmentText(assessment: SlideSelectionAssessment) {
  return `${assessment.role || ""} ${assessment.reason || ""}`.toLocaleLowerCase("ko-KR");
}

function contains(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function fallbackDiagramRichness(assessment: SlideSelectionAssessment) {
  const text = assessmentText(assessment);
  if (contains(text, /보기\s*드문|희소|독창|인포그래픽|로드맵|프로세스|조직도|관계도|다이어그램|도식/iu)) return 82;
  if (contains(text, /지도|차트|그래프|타임라인|매트릭스|플로우|시각화/iu)) return 72;
  if (contains(text, /이미지|사진|비주얼|표|table|chart|graph/iu)) return 55;
  if (contains(text, /표지|목차|간지|마무리|본문|텍스트|cover|contents|closing|text/iu)) return 20;
  return assessment.recommended ? 58 : 45;
}

function fallbackVisualQuality(assessment: SlideSelectionAssessment) {
  const legacy = normalizedScore(assessment.quality);
  if (legacy !== null) return clampScore(legacy + (assessment.recommended ? 5 : 0));
  const text = assessmentText(assessment);
  if (contains(text, /완성도|균형|정돈|세련|우수|멋|excellent|polished|balanced/iu)) return 80;
  if (contains(text, /표지|목차|간지|마무리|cover|contents|closing/iu)) return assessment.recommended ? 58 : 38;
  return assessment.recommended ? 72 : 52;
}

function fallbackRarity(assessment: SlideSelectionAssessment) {
  const text = assessmentText(assessment);
  if (contains(text, /보기\s*드문|희소|독창|차별|unique|rare|unusual/iu)) return 88;
  if (contains(text, /인포그래픽|로드맵|조직도|관계도|지도|매트릭스|타임라인/iu)) return 68;
  if (contains(text, /도식|다이어그램|프로세스|시각화|diagram|process/iu)) return 58;
  if (contains(text, /표지|목차|간지|마무리|본문|텍스트|cover|contents|closing|text/iu)) return 25;
  return assessment.recommended ? 52 : 42;
}

function scoreComponents(
  assessment: SlideSelectionAssessment,
  fallbackSectionDiversity = 50,
): SlideScoreComponents {
  return {
    diagramRichness: normalizedScore(assessment.diagramRichness) ?? fallbackDiagramRichness(assessment),
    visualQuality: normalizedScore(assessment.visualQuality) ?? fallbackVisualQuality(assessment),
    rarity: normalizedScore(assessment.rarity) ?? fallbackRarity(assessment),
    sectionDiversity: normalizedScore(assessment.sectionDiversity) ?? clampScore(fallbackSectionDiversity),
  };
}

function weightedTotal(components: SlideScoreComponents) {
  return rounded(
    components.diagramRichness * SLIDE_SELECTION_WEIGHTS.diagramRichness
    + components.visualQuality * SLIDE_SELECTION_WEIGHTS.visualQuality
    + components.rarity * SLIDE_SELECTION_WEIGHTS.rarity
    + components.sectionDiversity * SLIDE_SELECTION_WEIGHTS.sectionDiversity,
  );
}

function selectionReason(assessment: SlideSelectionAssessment, components: SlideScoreComponents) {
  const supplied = assessment.reason?.trim();
  if (supplied) return supplied;
  const entries: Array<[keyof SlideScoreComponents, string]> = [
    ["diagramRichness", "도식 구성"],
    ["visualQuality", "시각적 완성도"],
    ["rarity", "희소한 구성"],
    ["sectionDiversity", "문서 구간 다양성"],
  ];
  entries.sort((left, right) => components[right[0]] - components[left[0]]);
  return `${entries[0][1]} 점수를 우선 반영했습니다.`;
}

export function scoreSlideAssessment(
  assessment: SlideSelectionAssessment,
  fallbackSectionDiversity = 50,
): ScoredSlide {
  const components = scoreComponents(assessment, fallbackSectionDiversity);
  return {
    slideIndex: Math.floor(Number(assessment.slideIndex)),
    totalScore: weightedTotal(components),
    components,
    reason: selectionReason(assessment, components),
  };
}

function normalizedKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function wordTokens(value: unknown) {
  return new Set(normalizedKey(value).split(/\s+/u).filter((token) => token.length > 1));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });
  return intersection / (left.size + right.size - intersection);
}

function hashDistance(leftValue: unknown, rightValue: unknown) {
  const left = normalizedKey(leftValue).replace(/\s/g, "");
  const right = normalizedKey(rightValue).replace(/\s/g, "");
  if (left.length < 8 || left.length !== right.length) return null;
  if (/^[a-f0-9]{16}$/i.test(left) && /^[a-f0-9]{16}$/i.test(right)) {
    let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let bits = 0;
    while (difference > BigInt(0)) {
      bits += Number(difference & BigInt(1));
      difference >>= BigInt(1);
    }
    return bits / 64;
  }
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences += 1;
  }
  return differences / left.length;
}

function explicitSimilarityKey(assessment: SlideSelectionAssessment) {
  return normalizedKey(
    assessment.similarityKey
    || assessment.layoutSignature
    || assessment.visualSignature,
  );
}

/**
 * Uses explicit layout/image fingerprints when present and a conservative text
 * similarity fallback for legacy assessments. Blank legacy reasons never make
 * unrelated slides duplicates.
 */
export function areNearSimilarSlides(
  left: SlideSelectionAssessment,
  right: SlideSelectionAssessment,
) {
  const leftKey = explicitSimilarityKey(left);
  const rightKey = explicitSimilarityKey(right);
  if (leftKey && rightKey && leftKey === rightKey) return true;
  if (leftKey && rightKey) {
    const leftSignatureTokens = wordTokens(leftKey);
    const rightSignatureTokens = wordTokens(rightKey);
    if (leftSignatureTokens.size >= 3
      && rightSignatureTokens.size >= 3
      && jaccard(leftSignatureTokens, rightSignatureTokens) >= 0.68) {
      return true;
    }
  }

  const visualDistance = hashDistance(left.visualHash, right.visualHash);
  if (visualDistance !== null && visualDistance <= 0.08) return true;

  const leftTokens = wordTokens(`${left.role || ""} ${left.reason || ""}`);
  const rightTokens = wordTokens(`${right.role || ""} ${right.reason || ""}`);
  if (leftTokens.size < 4 || rightTokens.size < 4 || jaccard(leftTokens, rightTokens) < 0.82) return false;

  const leftScore = scoreComponents(left);
  const rightScore = scoreComponents(right);
  const averageDifference = (
    Math.abs(leftScore.diagramRichness - rightScore.diagramRichness)
    + Math.abs(leftScore.visualQuality - rightScore.visualQuality)
    + Math.abs(leftScore.rarity - rightScore.rarity)
  ) / 3;
  return averageDifference <= 12;
}

function canonicalAssessments(
  slideCount: number,
  assessments: readonly SlideSelectionAssessment[],
) {
  const byIndex = new Map<number, SlideSelectionAssessment>();
  assessments.forEach((assessment) => {
    const slideIndex = Math.floor(Number(assessment.slideIndex));
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slideCount) return;
    const normalized = { ...assessment, slideIndex };
    const previous = byIndex.get(slideIndex);
    if (!previous || scoreSlideAssessment(normalized).totalScore > scoreSlideAssessment(previous).totalScore) {
      byIndex.set(slideIndex, normalized);
    }
  });
  return Array.from({ length: slideCount }, (_, slideIndex) => byIndex.get(slideIndex) || ({ slideIndex }));
}

function deduplicateAssessments(assessments: SlideSelectionAssessment[]) {
  const ordered = [...assessments].sort((left, right) => {
    const scoreDifference = scoreSlideAssessment(right).totalScore - scoreSlideAssessment(left).totalScore;
    return scoreDifference || left.slideIndex - right.slideIndex;
  });
  const kept: SlideSelectionAssessment[] = [];
  const excludedDuplicates: ExcludedDuplicate[] = [];

  ordered.forEach((assessment) => {
    const duplicate = kept.find((candidate) => areNearSimilarSlides(assessment, candidate));
    if (duplicate) {
      excludedDuplicates.push({
        slideIndex: assessment.slideIndex,
        keptSlideIndex: duplicate.slideIndex,
        reason: "유사한 레이아웃 또는 시각 구성이 더 높은 점수의 장표와 중복됩니다.",
      });
      return;
    }
    kept.push(assessment);
  });

  return { kept, excludedDuplicates };
}

function sectionFor(assessment: SlideSelectionAssessment, slideCount: number) {
  const explicit = normalizedKey(assessment.sectionKey ?? assessment.section);
  if (explicit) return `explicit:${explicit}`;
  const sectionIndex = Math.min(4, Math.floor((assessment.slideIndex / Math.max(1, slideCount)) * 5));
  return `auto:${sectionIndex}`;
}

function fallbackDiversityForSelection(alreadySelectedInSection: number) {
  if (alreadySelectedInSection === 0) return 100;
  if (alreadySelectedInSection === 1) return 65;
  if (alreadySelectedInSection === 2) return 35;
  return 10;
}

export function selectPortfolioSlides(input: SlideSelectionInput): SlideSelectionResult {
  const slideCount = Number.isFinite(input.slideCount) ? Math.max(0, Math.floor(input.slideCount)) : 0;
  const mode = portfolioMockupMode(slideCount);
  if (mode === "insufficient") {
    return { mode, selectedSlideIndexes: [], selectedSlides: [], excludedDuplicates: [] };
  }

  const defaultLimit = SLIDE_SELECTION_LIMITS[mode];
  const requestedLimit = mode === "short" ? input.shortLimit : input.longLimit;
  const limit = Math.min(
    slideCount,
    Math.max(1, Math.floor(Number.isFinite(requestedLimit) ? Number(requestedLimit) : defaultLimit)),
  );
  const assessments = canonicalAssessments(slideCount, input.assessments || []);
  const { kept, excludedDuplicates } = deduplicateAssessments(assessments);
  const remaining = [...kept];
  const ranked: ScoredSlide[] = [];
  const selectedPerSection = new Map<string, number>();
  const minimumSelectionCount = Math.min(limit, mode === "short" ? 5 : 18);

  while (remaining.length && ranked.length < limit) {
    const candidates = remaining.map((assessment) => {
      const section = sectionFor(assessment, slideCount);
      const fallbackDiversity = fallbackDiversityForSelection(selectedPerSection.get(section) || 0);
      return { assessment, section, scored: scoreSlideAssessment(assessment, fallbackDiversity) };
    }).sort((left, right) => {
      const scoreDifference = right.scored.totalScore - left.scored.totalScore;
      if (scoreDifference) return scoreDifference;
      const recommendationDifference = Number(Boolean(right.assessment.recommended)) - Number(Boolean(left.assessment.recommended));
      return recommendationDifference || left.assessment.slideIndex - right.assessment.slideIndex;
    });

    const best = candidates[0];
    if (ranked.length >= minimumSelectionCount
      && best.scored.totalScore < SLIDE_SELECTION_MINIMUM_SCORE
      && !best.assessment.recommended) {
      break;
    }
    ranked.push({ ...best.scored, rank: ranked.length + 1 });
    selectedPerSection.set(best.section, (selectedPerSection.get(best.section) || 0) + 1);
    remaining.splice(remaining.indexOf(best.assessment), 1);
  }

  const completeRanked = mode === "long"
    ? ranked.slice(0, Math.floor(ranked.length / SIX_GRID_GROUP_SIZE) * SIX_GRID_GROUP_SIZE)
    : ranked;
  const selectedSlides = [...completeRanked].sort((left, right) => left.slideIndex - right.slideIndex);
  return {
    mode,
    selectedSlideIndexes: selectedSlides.map((slide) => slide.slideIndex),
    selectedSlides,
    excludedDuplicates: excludedDuplicates.sort((left, right) => left.slideIndex - right.slideIndex),
  };
}
