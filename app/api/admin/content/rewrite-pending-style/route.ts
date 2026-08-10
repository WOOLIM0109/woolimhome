import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "일괄 AI 재작성은 차단되었습니다. 변경 부분을 한 번에 모아 AI 검수를 실행해 주세요.",
    code: "GEMINI_COST_PROTECTION_ACTIVE",
    aiCalls: 0,
    nextAction: "/admin/editorial-maintenance",
  }, { status: 409 });
}
