export function portfolioDisplayState(item: {
  status: string;
  review_note?: string | null;
  metadata?: object | null;
  portfolio_jobs?: readonly unknown[];
}) {
  const metadata = (item.metadata || {}) as Record<string, unknown>;
  const reason = item.review_note || "";
  const missing = reason.match(/MISSING_FONTS:.*?(?:fonts:|글꼴[:：])\s*(.+)/i)?.[1]?.replace(/\.\s*$/, "");
  const fonts = Array.isArray(metadata.missingFonts) ? metadata.missingFonts.map(String).join(", ") : missing;
  if (item.status === "review_required") return { label: "검수 필요", detail: null };
  if (item.status === "published" || item.status === "approved" || item.status === "scheduled") return null;
  if (/유료 글꼴 미보유:/.test(reason)) return { label: "제외", detail: reason };
  if (fonts || /MISSING_FONTS/.test(reason)) return { label: "글꼴 대기", detail: fonts || reason };
  if (/retry limit|RETRY_LIMIT|MAX_ATTEMPTS/i.test(reason + String(metadata.portfolioTerminalErrorCode || ""))) return { label: "변환 실패(재시도 한도)", detail: reason };
  if (item.status === "draft_waiting" || ["design_completed", "draft_failed", "draft_waiting", "draft_retry_wait"].includes(String(metadata.portfolioStage))) {
    const generated = metadata.generated && typeof metadata.generated === "object"
      ? metadata.generated as Record<string, unknown>
      : null;
    const hasBody = typeof generated?.bodyHtml === "string" && generated.bodyHtml.trim().length > 0;
    if (Array.isArray(item.portfolio_jobs) && item.portfolio_jobs.length === 0 && !hasBody) {
      return { label: "본문 다시 만들기 필요", detail: "본문을 작성할 작업이 없어 자동으로 이어지지 않습니다. ‘글만 다시 쓰기’ 또는 ‘이미지와 글 전부 다시 만들기’를 눌러 주세요." };
    }
    return { label: "본문 작성 대기", detail: reason || "대기열에서 순서대로 작성합니다." };
  }
  if (item.status === "on_hold") return { label: "검수 필요", detail: reason };
  return null;
}
