export const PDF_LOCAL_REDACTION_ERROR_CODE = "PDF_LOCAL_REDACTION_UNSUPPORTED";
export const PDF_LOCAL_REDACTION_MESSAGE = "PDF 원본은 큰 제목을 제외한 텍스트·이미지의 로컬 좌표를 완전하게 증명할 수 없어 자동 디자인을 만들지 않습니다. PowerPoint 원본으로 다시 등록해 주세요.";

export function isPdfPortfolioSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as { sourceFormat?: unknown; originalFileName?: unknown };
  if (typeof source.sourceFormat === "string" && source.sourceFormat.toLowerCase() === "pdf") {
    return true;
  }
  if (typeof source.originalFileName !== "string") return false;
  return source.originalFileName.trim().toLowerCase().endsWith(".pdf");
}
