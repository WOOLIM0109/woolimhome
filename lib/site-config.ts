import { site } from "@/data/site";

export const SITE_URL = normalizeSiteUrl(site.url);
export const SITE_URL_OBJECT = new URL(`${SITE_URL}/`);
export const DEFAULT_OG_IMAGE = toAbsoluteUrl("/images/woolim-logo-cropped.png");

function normalizeSiteUrl(input?: string | null): string {
  const fallback = "https://woolimcompany.kr";
  const candidate = input?.trim();
  if (!candidate) return fallback;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function toAbsoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalized, SITE_URL_OBJECT).toString();
}

export function buildCanonical(path: string): string {
  return toAbsoluteUrl(path);
}

export function trimMetaDescription(value: string, maxChars = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const rough = normalized.slice(0, maxChars);
  const lastSpace = rough.lastIndexOf(" ");
  return rough.slice(0, lastSpace > 90 ? lastSpace : maxChars).trim();
}

export const robotsIndex = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-video-preview": -1,
    "max-image-preview": "large",
    "max-snippet": -1,
  },
} as const;
