export type PortfolioClientCategory =
  | "large_company"
  | "public_institution"
  | "general_company"
  | "unknown";

export function classifyPortfolioClientCategoryFromSourceHint(
  sourceHint: string,
): PortfolioClientCategory {
  const source = sourceHint.normalize("NFKC").toLocaleLowerCase("ko-KR");
  if (/공공기관|공기관|정부기관|중앙정부|지방자치단체|지자체|시청|군청|도청|교육청/.test(source)) {
    return "public_institution";
  }
  if (/대기업|그룹사/.test(source)) return "large_company";
  // A company name is not evidence of its size. Names such as "현대" are
  // shared by unrelated businesses, so keep the category unverified unless
  // the source explicitly describes the customer class.
  return "unknown";
}
