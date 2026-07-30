import type { ContentChannel, WorkflowStatus } from "@/lib/content-ops/types";

export const PARTNER_CHANNELS: ContentChannel[] = ["naver_consulting", "naver_design"];
export const PARTNER_VISIBLE_STATUSES: WorkflowStatus[] = [
  "approved",
  "naver_ready",
  "scheduled",
  "published",
];

export function isPartnerChannel(value: unknown): value is ContentChannel {
  return typeof value === "string" && PARTNER_CHANNELS.includes(value as ContentChannel);
}

export function isPartnerVisibleStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && PARTNER_VISIBLE_STATUSES.includes(value as WorkflowStatus);
}

export function isPartnerReleaseReady(item: {
  format: string;
  status: string;
  metadata?: {
    novelty?: { duplicate?: boolean };
    validation?: { issues?: string[] };
  } | null;
}) {
  if (!isPartnerVisibleStatus(item.status)) return false;
  if (item.status === "published" || item.format === "portfolio") return true;

  return item.metadata?.novelty?.duplicate === false
    && Array.isArray(item.metadata?.validation?.issues)
    && item.metadata.validation.issues.length === 0;
}

export function partnerAssetUrl(id: string, download = false) {
  return `/api/partner/assets?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
}

export function replaceAdminAssetUrls(
  html: string,
  assets: { id: string; public_url: string }[],
) {
  return assets.reduce((result, asset) => {
    const replacement = partnerAssetUrl(asset.id);
    return result
      .split(asset.public_url)
      .join(replacement)
      .split(asset.public_url.replaceAll("&", "&amp;"))
      .join(replacement.replaceAll("&", "&amp;"));
  }, html);
}

export function replaceFiguresWithMarkers(html: string) {
  let bodyImageNumber = 0;
  return html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (figure) => {
    bodyImageNumber += 1;
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim();
    const captionText = caption ? ` — ${caption}` : "";
    return `<p><strong>[본문 이미지 ${bodyImageNumber} 삽입${captionText}]</strong></p>`;
  });
}

export function sanitizeGeneratedHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "");
}

export function parseStoredAssetUrl(publicUrl: string) {
  const parsed = new URL(publicUrl, "https://woolim-site.vercel.app");
  if (parsed.pathname !== "/api/admin/assets") return null;

  const bucket = parsed.searchParams.get("bucket");
  const path = parsed.searchParams.get("path");
  if (bucket !== "portfolio-rendered" || !path || path.includes("..")) return null;

  return { bucket, path };
}
