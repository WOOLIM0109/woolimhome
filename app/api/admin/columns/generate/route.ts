import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { generateColumn } from "@/lib/columns/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 180;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    // 예산 관문을 통과해야만 실제 호출이 일어납니다.
    // 상한을 넘었거나 GEMINI_ENABLED가 꺼져 있으면 여기서 멈춥니다.
    const result = await runBudgetedGeminiAutomation({
      operation: "column-generate",
      actor: user.email || "admin",
      // 조사 1회 + 본문 생성 1회 + 분량 미달 시 재생성 1회
      plannedCalls: 3,
    }, () => generateColumn({
      topicHint: typeof body.topicHint === "string" ? body.topicHint.trim() : undefined,
      sourceUrls: Array.isArray(body.sourceUrls) ? body.sourceUrls : [],
      createdBy: user.email!,
    }));
    return NextResponse.json(result, { status: result.blocked ? 422 : 201 });
  } catch (error) {
    if (error instanceof GeminiAutomationBlocked) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "초안 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
