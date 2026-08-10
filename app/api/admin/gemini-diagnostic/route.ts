import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";

export const runtime = "nodejs";

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "GEMINI_COST_PROTECTION_ACTIVE",
    message: "비용 보호 모드에서는 실제 Gemini 진단 요청을 전송하지 않습니다.",
    networkRequested: false,
  }, { status: 409 });
}
