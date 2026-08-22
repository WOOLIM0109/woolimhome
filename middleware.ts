import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { detectBot } from "@/lib/bot-detection";
import { attributeBotPath } from "@/lib/bot-path-attribution";

/**
 * script-src 의 'unsafe-inline' 은 일부러 남겨 둔 것입니다.
 *
 * 이것 때문에 페이지에 끼어든 스크립트도 실행될 수 있어, 이 정책이 정작
 * 막아야 할 것을 막지 못합니다. 그래서 요청마다 표를 발급하는 nonce 방식으로
 * 바꿔 보았는데, 그 표는 요청이 있어야 만들어집니다. 미리 만들어 두는
 * 페이지에는 붙일 자리가 없어서, 공개 페이지 서른네 곳이 다섯 곳으로 줄고
 * 나머지는 전부 매 요청 서버에서 그려야 했습니다. 속도와 비용을 그만큼
 * 내주는 셈이라 되돌렸습니다.
 *
 * 지금 본문에 들어오는 HTML 은 서버에서 sanitize-html 로 한 번 걸러집니다.
 * 이 정책을 조이는 것은 그 위에 한 겹 더 두는 일이라, 공개 페이지를 전부
 * 동적으로 바꿀 만큼 급하지는 않다고 보았습니다.
 *
 * 나중에 공개 페이지가 어차피 동적으로 바뀐다면 그때 다시 볼 일입니다.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

function securedResponse() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function maskedIp(request: NextRequest) {
  const raw = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "";
  if (!raw) return null;
  if (raw.includes(".")) {
    const parts = raw.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : null;
  }
  if (raw.includes(":")) return `${raw.split(":").slice(0, 4).join(":")}::`;
  return null;
}

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const response = securedResponse();
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/admin") || pathname.startsWith("/api") || pathname.startsWith("/auth")) {
    return response;
  }

  const bot = detectBot(request.headers.get("user-agent"));
  if (!bot) return response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return response;

  const { pageKind, entitySlug } = attributeBotPath(pathname);
  const country = request.headers.get("x-vercel-ip-country")
    || request.headers.get("cf-ipcountry")
    || null;
  const userAgent = request.headers.get("user-agent") || "";

  event.waitUntil(
    fetch(`${supabaseUrl}/rest/v1/bot_traffic_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        bot_name: bot.name,
        bot_category: bot.category,
        bot_operator: bot.operator || null,
        page_kind: pageKind,
        entity_slug: entitySlug,
        user_agent: userAgent,
        requested_path: pathname,
        ip_address: maskedIp(request),
        country,
      }),
    }).catch((error) => {
      console.error("[Bot traffic] logging failed", error);
    }),
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)"],
};
