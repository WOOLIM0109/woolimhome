import { textSimilarity } from "./novelty.ts";

/**
 * 하루에 내보낼 공고 고르기
 *
 * 지원사업 공고는 같은 사업이 지역·회차만 바꿔 며칠에 걸쳐 올라옵니다.
 * 수집된 순서대로 내보내면 어제와 거의 같은 목록이 나갑니다.
 * 실제로 "어제 것과 너무 똑같다"는 이야기가 나왔습니다.
 *
 * 그래서 두 가지를 봅니다.
 *   · 최근에 이미 내보낸 공고와 닮았으면 뒤로 미룹니다
 *   · 오늘 고른 것들끼리도 닮지 않게 합니다
 *
 * 미룬 공고는 버리지 않습니다. 다음 영업일 후보로 넘깁니다.
 * 골라야 할 수를 못 채우면 덜 닮은 것부터 되살려 채웁니다.
 */

type PickCandidate = {
  id: string;
  title: string;
  categories?: string[] | null;
};

type RecentProgram = {
  title: string;
  categories?: string[] | null;
};

/** 이 점수 이상이면 같은 이야기로 봅니다. */
export const DAILY_SIMILARITY_LIMIT = 42;

function describe(item: PickCandidate | RecentProgram) {
  return `${item.title} ${(item.categories || []).join(" ")}`;
}

function envNumber(name: string, fallback: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
}

export function similarityLimit() {
  return envNumber("OPENCHAT_SIMILARITY_LIMIT", DAILY_SIMILARITY_LIMIT, 100);
}

export function pickDistinctPrograms(input: {
  /** 오늘 후보. 이미 중요한 순서로 정렬되어 있어야 합니다. */
  candidates: PickCandidate[];
  /** 최근에 내보낸 공고들. */
  recent: RecentProgram[];
  limit: number;
}) {
  const limit = Math.max(0, Math.floor(input.limit));
  if (!limit) return { picked: [], deferred: input.candidates.map((item) => item.id) };

  const threshold = similarityLimit();
  const recentTexts = input.recent.map(describe);
  const picked: PickCandidate[] = [];
  const pickedTexts: string[] = [];
  const skipped: { item: PickCandidate; score: number }[] = [];

  for (const candidate of input.candidates) {
    if (picked.length >= limit) {
      skipped.push({ item: candidate, score: 0 });
      continue;
    }
    const text = describe(candidate);
    const against = [...recentTexts, ...pickedTexts];
    const score = against.reduce((worst, other) => Math.max(worst, textSimilarity(text, other)), 0);
    if (score >= threshold) {
      skipped.push({ item: candidate, score });
      continue;
    }
    picked.push(candidate);
    pickedTexts.push(text);
  }

  // 닮았다고 걸러 낸 탓에 수가 모자라면 덜 닮은 것부터 되살립니다.
  const restorable = skipped
    .filter((entry) => entry.score > 0)
    .sort((left, right) => left.score - right.score);
  while (picked.length < limit && restorable.length) {
    const entry = restorable.shift();
    if (!entry) break;
    picked.push(entry.item);
  }

  const pickedIds = new Set(picked.map((item) => item.id));
  return {
    picked,
    deferred: input.candidates.filter((item) => !pickedIds.has(item.id)).map((item) => item.id),
  };
}
