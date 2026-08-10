import { friendlyStyleIssues } from "./editorial-style.ts";
import { publicSourceUrls } from "./source-section.ts";

type PublicationDraft = {
  bodyHtml?: unknown;
  faq?: unknown;
  sourceUrls?: unknown;
};

export function editorialPublicationIssues(
  format: string,
  generated: PublicationDraft | null | undefined,
) {
  if (!generated || typeof generated.bodyHtml !== "string" || !generated.bodyHtml.trim()) {
    return ["검수할 본문이 없습니다."];
  }
  const faq = Array.isArray(generated.faq)
    ? generated.faq.filter((item): item is { question?: string; answer?: string } => (
      Boolean(item) && typeof item === "object"
    ))
    : [];
  // 포트폴리오는 이미지가 중심이라 목록·기호 규칙을 요구하지 않습니다.
  const issues = friendlyStyleIssues(generated.bodyHtml, faq, {
    requireLiveliness: format !== "portfolio",
  });
  if (faq.length < 3 || faq.length > 4) {
    issues.push("FAQ는 3~4개로 구성하세요.");
  }
  if (format !== "portfolio" && publicSourceUrls(generated.sourceUrls).length < 2) {
    issues.push("본문 하단에 표시할 공개 출처가 2개 미만입니다.");
  }
  return [...new Set(issues)];
}
