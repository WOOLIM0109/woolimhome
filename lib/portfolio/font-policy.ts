/** Business policy: installation never implies a purchased production license. */
export const UNOWNED_PAID_FONT_FAMILIES: readonly string[] = Object.freeze(["Söhne"]);
export const PORTFOLIO_FONT_POLICY_VERSION = "unowned-fonts-v1";
const fontKey = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
export const isTestFontName = (name: string) => /test/i.test(name);
export function unownedPaidFonts(names: readonly string[]) {
  return UNOWNED_PAID_FONT_FAMILIES.filter(family => names.some(name => fontKey(name).includes(fontKey(family))));
}
type FontCandidate = { missing_fonts?: string[]; exclusion_reasons?: string[]; metadata?: Record<string, unknown> };
export function portfolioFontExclusion(candidate: FontCandidate): string | null {
  const sourceFonts = Array.isArray(candidate.metadata?.sourceFonts)
    ? candidate.metadata.sourceFonts.filter((name): name is string => typeof name === "string") : [];
  const blocked = unownedPaidFonts([...(candidate.missing_fonts || []), ...sourceFonts]);
  if (blocked.length) return `유료 글꼴 미보유: ${blocked.join(", ")}`;
  // Explicit exclusions survive inventory changes and forced retries.
  return candidate.exclusion_reasons?.find(reason => reason.startsWith("유료 글꼴 미보유:"))
    || (typeof candidate.metadata?.fontExclusionReason === "string" ? candidate.metadata.fontExclusionReason : null);
}
export function canRetryCandidateFonts(candidate: FontCandidate & { font_retry_fingerprint?: string | null }, fingerprint: string, force = false) {
  return !portfolioFontExclusion(candidate) && (force || candidate.font_retry_fingerprint !== fingerprint);
}
