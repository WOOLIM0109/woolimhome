function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function publicSourceUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      const normalized = url.toString();
      unique.set(normalized, normalized);
    } catch {
      continue;
    }
  }
  return [...unique.values()].slice(0, 8);
}

export const PRIVATE_PORTFOLIO_SOURCE_NOTE = "자료: 의뢰인이 제공한 원본 문서(기밀 보호를 위해 세부 출처 비공개)";

export function sourceSectionHtml(
  value: unknown,
  options: { note?: string | null } = {},
) {
  const urls = publicSourceUrls(value);
  const note = typeof options.note === "string" ? options.note.trim() : "";
  if (!urls.length && !note) return "";
  const items = urls.map((url) => {
    const parsed = new URL(url);
    const label = parsed.hostname.replace(/^www\./, "");
    return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
  });
  return `<section class="column-sources"><h2>출처</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}${items.length ? `<ol>${items.join("")}</ol>` : ""}</section>`;
}
