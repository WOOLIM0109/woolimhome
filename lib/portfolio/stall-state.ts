import { portfolioDisplayState } from "./display-state.ts";

type PortfolioStallItem = Parameters<typeof portfolioDisplayState>[0] & {
  updated_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 화면의 상태 판정에, 마지막 변경 후 지난 시간만 더합니다. */
export function portfolioStallState(item: PortfolioStallItem, now = new Date()) {
  const state = portfolioDisplayState(item);
  if (!state) return null;
  const age = now.getTime() - Date.parse(item.updated_at);
  if (!Number.isFinite(age) || age < 0) return null;

  let reason: string;
  switch (state.label) {
    case "본문 다시 만들기 필요":
      reason = "본문 작업 없음";
      break;
    case "본문 작성 대기":
      if (age <= DAY_MS) return null;
      reason = "본문 작성 대기";
      break;
    case "글꼴 대기":
      if (age <= DAY_MS) return null;
      reason = "글꼴 없음";
      break;
    case "검수 필요":
      if (item.status !== "on_hold" || age <= 2 * DAY_MS) return null;
      reason = "보류";
      break;
    default:
      return null;
  }
  return { ...state, days: Math.max(1, Math.ceil(age / DAY_MS)), reason };
}
