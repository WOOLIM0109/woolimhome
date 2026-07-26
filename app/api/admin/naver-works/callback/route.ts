import { NextRequest, NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { exchangeAuthorizationCode } from "@/lib/naver-works/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.redirect(new URL("/admin/sources?works=unauthorized", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get("naver_works_oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/admin/sources?works=invalid_state", request.url));
  }
  try {
    await exchangeAuthorizationCode(code, user.email || "");
    const response = NextResponse.redirect(new URL("/admin/sources?works=connected", request.url));
    response.cookies.delete("naver_works_oauth_state");
    return response;
  } catch (error) {
    const url = new URL("/admin/sources", request.url);
    url.searchParams.set("works", "error");
    url.searchParams.set("message", error instanceof Error ? error.message.slice(0, 180) : "연결 실패");
    return NextResponse.redirect(url);
  }
}
