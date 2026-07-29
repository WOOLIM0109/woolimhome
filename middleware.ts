import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { detectBot } from "@/lib/bot-detection";
import { attributeBotPath } from "@/lib/bot-path-attribution";

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
  const response = NextResponse.next();
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
