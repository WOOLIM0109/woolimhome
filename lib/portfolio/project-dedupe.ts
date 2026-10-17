import { normalizePortfolioProjectName } from "./project-name.ts";
import { portfolioFontExclusion } from "./font-policy.ts";
import { driveFile, type CandidateRow } from "../naver-works/portfolio-selection.ts";

export const PORTFOLIO_DEDUPE_VERSION = "project-dedupe-v1";
export type ProjectReference = {
  id: string; title: string; normalizedName: string; url?: string; candidateId?: string;
  hashes: string[];
};
export function validProjectHashes(value: unknown): string[] {
  // Uniform/near-uniform images are not project evidence (blank-slide collisions).
  return Array.isArray(value) ? value.filter((hash): hash is string => {
    if (typeof hash !== "string" || !/^[a-f0-9]{16}$/i.test(hash)) return false;
    const ones = [...BigInt(`0x${hash}`).toString(2)].filter(bit => bit === "1").length;
    return ones >= 8 && ones <= 56;
  }) : [];
}
export function projectHashDistance(a: string, b: string) {
  let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (xor) { count += Number(xor & BigInt(1)); xor >>= BigInt(1); }
  return count;
}
export function compareProjectSources(a: CandidateRow, b: CandidateRow) {
  const left = driveFile(a), right = driveFile(b);
  const pptx = (name = "") => /\.pptx$/i.test(name) ? 1 : 0;
  const date = (value?: string | null) => Number.isFinite(Date.parse(value || "")) ? Date.parse(value!) : 0;
  return pptx(right?.file_name) - pptx(left?.file_name)
    || date(right?.modified_at) - date(left?.modified_at)
    || Number(/사본|copy/i.test(left?.file_name || "")) - Number(/사본|copy/i.test(right?.file_name || ""))
    || a.id.localeCompare(b.id);
}
export function inspectPortfolioDuplicates(rows: CandidateRow[], publications: ProjectReference[], hashThreshold: number) {
  if (!Number.isInteger(hashThreshold) || hashThreshold < 0 || hashThreshold > 8) throw new Error("지각 해시 기준값 검수가 필요합니다.");
  const name = (row: CandidateRow) => normalizePortfolioProjectName(row.project_name || driveFile(row)?.file_name || "");
  const reference = (row: CandidateRow): ProjectReference => ({ id: row.id, candidateId: row.id, title: row.project_name,
    normalizedName: name(row), hashes: validProjectHashes(row.metadata?.representativeHashes) });
  const active = rows.filter(row => ["selected", "processed", "on_hold"].includes(row.status)).map(reference);
  const accepted: CandidateRow[] = [];
  const decisions = rows.filter(row => row.status === "candidate").sort(compareProjectSources).map(row => {
    const fontExclusionReason = portfolioFontExclusion(row);
    const key = name(row), hashes = validProjectHashes(row.metadata?.representativeHashes);
    const references = [...publications, ...active, ...accepted.map(reference)].filter(ref => ref.candidateId !== row.id);
    let bestScore = 0;
    let match: ProjectReference | undefined;
    let distance: number | null = null;
    for (const ref of references) {
      if (key && key === ref.normalizedName) { bestScore = 100; match = ref; distance = null; break; }
      const distances = hashes.flatMap(hash => validProjectHashes(ref.hashes).map(other => projectHashDistance(hash, other)));
      if (!distances.length) continue;
      const closest = Math.min(...distances), score = Math.round((1 - closest / 64) * 100);
      if (score > bestScore) bestScore = score;
      if (closest <= hashThreshold && (!match || distance === null || closest < distance)) { match = ref; distance = closest; }
    }
    if (!match && key && !fontExclusionReason) accepted.push(row);
    return { candidate: row, normalizedName: key, duplicateScore: bestScore, match, distance, fontExclusionReason,
      reason: fontExclusionReason || (match ? `중복: ${match.title} (${match.url || match.candidateId || match.id})` : key ? null : "검수 필요: 정규화 프로젝트명이 비어 있습니다.") };
  });
  const groups = [...new Set(decisions.map(row => row.normalizedName))].map(key => ({ normalizedName: key,
    files: decisions.filter(row => row.normalizedName === key).map(row => row.candidate.id),
    selected: accepted.find(row => name(row) === key)?.id || null }));
  return { accepted, decisions, groups };
}
