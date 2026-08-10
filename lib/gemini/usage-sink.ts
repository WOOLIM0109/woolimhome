import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 한 작업이 실제로 쓴 토큰을 모으는 그릇.
 *
 * 예산을 잡을 때는 넉넉하게 예약해 두고, 작업이 끝나면 여기 모인 실제 사용량으로 바꿔 적습니다.
 * 이 교체가 없으면 예약값이 그대로 남아 실제보다 훨씬 빨리 상한에 도달합니다.
 */
export type GeminiUsageTally = {
  inputTokens: number;
  outputTokens: number;
  networkAttempts: number;
};

const usageStorage = new AsyncLocalStorage<GeminiUsageTally>();

export function createGeminiUsageTally(): GeminiUsageTally {
  return { inputTokens: 0, outputTokens: 0, networkAttempts: 0 };
}

export function runWithGeminiUsageTally<T>(tally: GeminiUsageTally, work: () => Promise<T>) {
  return usageStorage.run(tally, work);
}

/** 그릇이 없으면 아무 일도 하지 않습니다. 검수 경로 등 다른 흐름에는 영향이 없습니다. */
export function reportGeminiUsage(value: Partial<GeminiUsageTally>) {
  const tally = usageStorage.getStore();
  if (!tally) return;
  tally.inputTokens += Math.max(0, value.inputTokens || 0);
  tally.outputTokens += Math.max(0, value.outputTokens || 0);
  tally.networkAttempts += Math.max(0, value.networkAttempts || 0);
}
