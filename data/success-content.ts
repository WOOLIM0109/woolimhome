import { getPublicClientName } from "./public-content.ts";
import { caseHighlightDefinitions, consultingCaseDefinitions, pptCaseDefinitions, quickWinDefinitions } from "./content.ts";
import { getSuccessLedger, type SuccessRecord } from "./success-ledger.ts";
import { formatWon } from "./success-metrics.ts";

async function publicRecords() {
  return (await getSuccessLedger()).filter((item) => item.publicApproved && item.stage === "final");
}

function result(record: SuccessRecord) {
  const outcome = record.track === "bidding" ? "낙찰" : record.track === "investment" ? "투자유치" : "선정";
  return `${record.program} ${outcome} — ${formatWon(record.amountWon)} 원`;
}

export async function getConsultingCases() {
  const records = await publicRecords();
  return consultingCaseDefinitions.flatMap((item) => {
    const wins = item.ledgerIds.flatMap((id) => records.filter((record) => record.id === id));
    if (!wins.length) return [];
    const fundingCount = wins.filter((record) => record.track === "funding").length;
    const investmentCount = wins.filter((record) => record.track === "investment").length;
    return [{ ...item,
      clientKey: wins[0].clientKey, company: getPublicClientName(wins[0].clientKey),
      headline: `${formatWon(wins.reduce((total, record) => total + record.amountWon, 0))} 원`,
      wins: wins.map(result),
      resultSummary: `지원사업 ${fundingCount}건 선정${investmentCount ? ` · 투자유치 ${investmentCount}건` : ""}`,
    }];
  });
}

export async function getPptCases() {
  const records = await publicRecords();
  return pptCaseDefinitions.map((group) => ({ ...group, items: group.items.flatMap((item) => {
    const ledgerId = "ledgerId" in item ? item.ledgerId : undefined;
    const record = ledgerId ? records.find((row) => row.id === ledgerId) : undefined;
    if (ledgerId && !record) return [];
    const clientKey = record?.clientKey ?? ("clientKey" in item ? item.clientKey : "");
    return [{ ...item, clientKey, company: getPublicClientName(clientKey), result: record?.track === "bidding" ? `${formatWon(record.amountWon)} 원 낙찰` : "result" in item ? item.result : "최종 확정" }];
  }) }));
}

export async function getQuickWins() {
  const records = await publicRecords();
  return quickWinDefinitions.flatMap((item) => {
    const record = records.find((row) => row.id === item.ledgerId);
    return record ? [{ item: item.item, program: record.program, amount: `${formatWon(record.amountWon)} 원` }] : [];
  });
}

export async function getCaseHighlights() {
  const records = await publicRecords();
  return caseHighlightDefinitions.flatMap((item) => {
    const record = item.ledgerId ? records.find((row) => row.id === item.ledgerId) : undefined;
    if (item.ledgerId && !record) return [];
    return [{ ...item, result: record ? `${formatWon(record.amountWon)} 원${record.track === "bidding" ? " 낙찰" : ""}` : item.result ?? "최종 확정" }];
  });
}
