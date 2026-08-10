import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "칼럼 자동 생성은 Gemini 비용 보호 모드에서 차단됩니다.",
    code: "GEMINI_COST_PROTECTION_ACTIVE",
    aiCalls: 0,
    nextAction: "/admin/editorial-maintenance",
  }, { status: 409 });
}
