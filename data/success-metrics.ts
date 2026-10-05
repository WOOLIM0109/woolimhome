import { getSuccessLedger, type SuccessRecord, type SuccessTrack } from "./success-ledger.ts";

export const consultingProductionMetric = {
  value: "300+",
  label: "누적 컨설팅·제작",
  basis: "대표 확정 표기",
} as const;

export function formatWon(amountWon: number): string {
  const eok = Math.floor(amountWon / 100_000_000);
  const man = Math.floor((amountWon % 100_000_000) / 10_000);
  return [eok ? `${eok.toLocaleString("ko-KR")}억` : "", man ? `${man.toLocaleString("ko-KR")}만` : ""].filter(Boolean).join(" ") || "0";
}

export function floorAchievement(amountWon: number): string {
  return `${Math.floor(amountWon / 100_000_000)}억+`;
}

export function calculateSuccessMetrics(ledger: readonly SuccessRecord[]) {
  const confirmed = ledger.filter((item) => item.stage === "final" && item.publicApproved);
  const sum = (items: readonly SuccessRecord[]) => items.reduce((total, item) => total + item.amountWon, 0);
  const track = (key: SuccessTrack, label: string) => {
    const rows = confirmed.filter((item) => item.track === key);
    const amountWon = sum(rows);
    return { key, label, count: rows.length, amountWon, amount: formatWon(amountWon), largestWon: Math.max(0, ...rows.map((item) => item.amountWon)) };
  };
  const funding = track("funding", "정부지원사업·R&D");
  const bidding = track("bidding", "입찰·수주");
  const investment = track("investment", "투자유치");
  const breakdown = [funding, bidding, investment];
  const totalWon = breakdown.reduce((total, item) => total + item.amountWon, 0);
  const years = confirmed.flatMap((item) => item.year === null ? [] : [item.year]);
  const summary = {
    total: { value: floorAchievement(totalWon), label: "선정·낙찰·투자 누적" },
    production: consultingProductionMetric,
    largestBid: { value: formatWon(bidding.largestWon), label: "단일 입찰 최대 낙찰" },
    largestGrant: { value: formatWon(funding.largestWon), label: "단일 과제 최대 선정" },
    entries: { value: `${confirmed.filter((item) => item.track === "entry").length}건`, label: "대기업·백화점 입점 합격" },
  };
  return { totalWon, total: formatWon(totalWon), funding, bidding, investment, breakdown, summary,
    period: years.length ? `${Math.min(...years)}~${Math.max(...years)}` : "",
    wposition: {
      totalWon: sum(confirmed.filter((item) => item.customerId === "wposition" && ["funding", "investment"].includes(item.track))),
      fundingWon: sum(confirmed.filter((item) => item.customerId === "wposition" && item.track === "funding")),
    },
  };
}

export async function getSuccessMetrics() {
  return calculateSuccessMetrics(await getSuccessLedger());
}
