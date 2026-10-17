/** Normalize source filenames, never generated article titles or directory paths. */
export function normalizePortfolioProjectName(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/^.*[\\/]/, "")
    .replace(/\.(pptx?|pdf|key|odp)$/i, "")
    .replace(/\d+\s*(?:pages?|p|쪽|페이지)(?=$|[^a-z])/gi, "")
    .replace(/(?:19|20)\d{2}[.\-_년 ]?(?:0[1-9]|1[0-2])[.\-_월 ]?(?:0[1-9]|[12]\d|3[01])일?/g, "")
    .replace(/(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/g, "")
    .replace(/(?:version|ver\.?|v)\s*\d+(?:[._]\d+)*/gi, "")
    .replace(/(?:최종본|발표본|완성본|원본|사본|최종|수정)(?:\s*\d+(?:차)?)?/g, "")
    .replace(/(?:final|copy|revised|revision)(?:\s*\d+)?/gi, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}
