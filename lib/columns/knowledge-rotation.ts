/**
 * 원천자료를 골고루 돌려쓰기
 *
 * 칼럼을 쓸 때 AI 에게 넘기는 자료는 열두 개뿐입니다.
 * 예전에는 그 열두 개를 '가장 최근에 올린 것'으로 골랐습니다.
 * 그래서 먼저 올린 자료는 한 번도 안 쓰였는데도 후보에 들지 못했고,
 * 이미 여러 번 쓴 자료가 계속 다시 불려 나왔습니다.
 * 승인 자료 27개 중 절반 이상이 그대로 잠들어 있었고, 칼럼 주제도 한쪽으로 쏠렸습니다.
 *
 * 그래서 두 가지를 함께 봅니다.
 *   · 덜 쓰인 자료를 먼저 (쓸수록 뒤로 밀려 저절로 돌아갑니다)
 *   · 전문 분야를 번갈아 (한 분야가 열두 자리를 다 차지하지 않습니다)
 */

type KnowledgeItem = {
  id?: string | null;
  expertise_area?: string | null;
  use_count?: number | null;
  created_at?: string | null;
};

/** 한 번에 넘길 자료 수. */
export const KNOWLEDGE_PER_COLUMN = 12;

/**
 * 후보로 읽어 둘 자료 수.
 *
 * 어떤 열두 개를 쓸지 고르려면 승인 자료 전부를 한 번 봐야 합니다.
 * 지금은 27개이고, 늘어나도 이 수까지는 그대로 봅니다.
 */
export const KNOWLEDGE_POOL_LIMIT = 200;

const AREA_FALLBACK = "general";

function timesUsed(item: KnowledgeItem) {
  const value = Number(item.use_count);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function createdAt(item: KnowledgeItem) {
  return typeof item.created_at === "string" ? item.created_at : "";
}

/** 덜 쓰인 것 먼저, 같으면 최근에 올린 것 먼저. */
function byRotation(left: KnowledgeItem, right: KnowledgeItem) {
  const gap = timesUsed(left) - timesUsed(right);
  if (gap !== 0) return gap;
  return createdAt(right).localeCompare(createdAt(left));
}

export function selectRotatingKnowledge<T extends KnowledgeItem>(
  items: T[],
  limit = KNOWLEDGE_PER_COLUMN,
) {
  if (limit <= 0) return [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const area = item.expertise_area || AREA_FALLBACK;
    const list = groups.get(area) || [];
    list.push(item);
    groups.set(area, list);
  }
  for (const list of groups.values()) list.sort(byRotation);

  // 덜 쓰인 자료를 가진 분야부터 돕니다. 같은 조건이면 이름 순으로 정해 둡니다.
  const areas = [...groups.keys()].sort((left, right) => {
    const first = groups.get(left)?.[0];
    const second = groups.get(right)?.[0];
    const gap = timesUsed(first || {}) - timesUsed(second || {});
    if (gap !== 0) return gap;
    return left.localeCompare(right);
  });

  const picked: T[] = [];
  let round = 0;
  while (picked.length < limit) {
    let addedThisRound = false;
    for (const area of areas) {
      const list = groups.get(area);
      const item = list?.[round];
      if (!item) continue;
      picked.push(item);
      addedThisRound = true;
      if (picked.length >= limit) break;
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return picked;
}
