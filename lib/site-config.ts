import { site } from "@/data/site";

/**
 * 운영 도메인은 www 쪽입니다. apex(`woolimcompany.kr`)로 들어온 요청은
 * 서버에서 www로 308 이동시키므로, canonical·sitemap·robots·llms.txt가
 * apex를 가리키면 전부 "이동당하는 주소"를 내보내게 됩니다. 그래서 기준값을
 * www로 둡니다. 환경변수 NEXT_PUBLIC_SITE_URL이 비거나 잘못된 값일 때
 * 떨어지는 자리라, 여기까지 www여야 어느 경로로도 apex가 새어나가지 않습니다.
 */
const OFFICIAL_SITE_URL = "https://www.woolimcompany.kr";

export const SITE_URL = normalizeSiteUrl(site.url);
export const SITE_URL_OBJECT = new URL(`${SITE_URL}/`);
export const DEFAULT_OG_IMAGE = toAbsoluteUrl("/images/woolim-logo-cropped.png");

function normalizeSiteUrl(input?: string | null): string {
  const fallback = OFFICIAL_SITE_URL;
  const candidate = input?.trim();
  if (!candidate) return fallback;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    if (parsed.hostname.endsWith(".vercel.app")) {
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
