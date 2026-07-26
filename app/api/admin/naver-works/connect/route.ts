import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { authorizationUrl } from "@/lib/naver-works/client";

export const runtime = "nodejs";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(authorizationUrl(state));
    response.cookies.set("naver_works_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/admin/naver-works",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "연결 준비 실패" }, { status: 500 });
  }
}
