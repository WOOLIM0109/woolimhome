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
  // 포트폴리오 본문도 같은 규칙을 적용합니다.
  const issues = friendlyStyleIssues(generated.bodyHtml, faq, { requireLiveliness: true });
  if (faq.length < 3 || faq.length > 4) {
    issues.push("FAQ는 3~4개로 구성하세요.");
  }
  /*
   * 출처 개수로 발행을 막지 않습니다.
   *
   * 예전에는 2개 미만이면 보류였습니다. 그 한 줄 때문에 멀쩡히 써 둔 글이
   * 계속 걸렸습니다. 출처가 몇 개인지는 화면에 그대로 보여 주고, 그 글을
   * 낼지 말지는 사람이 봅니다. 기계가 개수만 세어 막을 일이 아닙니다.
   *
   * 사실 자체의 근거는 조사 단계에서 이미 봅니다(lib/research/official.ts).
   * 출처를 못 댄 내용은 거기서 본문에 들어오지 못합니다.
   */
  return [...new Set(issues)];
}
