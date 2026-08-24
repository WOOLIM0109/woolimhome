import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { generateColumn } from "@/lib/columns/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import { createClient } from "@/lib/supabase/server";

// 문체 재작성까지 붙어 몇 분이 걸립니다. 180초로는 만들다가 끊깁니다.
export const maxDuration = 300;

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
      // 주제 기획 1 + 조사 1 + 작성 1 + 응답 실패 시 1 + 분량 미달 시 1 + 문체 2
      plannedCalls: 7,
    }, () => generateColumn({
      topicHint: typeof body.topicHint === "string" ? body.topicHint.trim() : undefined,
      sourceUrls: Array.isArray(body.sourceUrls) ? body.sourceUrls : [],
      createdBy: user.email!,
    }));
    /*
     * 기준을 못 넘겨도 글은 저장됩니다. 그러니 실패(422)가 아니라 생성(201)입니다.
     * 예전에는 422 로 돌려주고 화면이 붉은 오류 상자를 띄웠는데, 정작 글은
     * 버려져서 대표님이 할 수 있는 일이 없었습니다.
     */
    return NextResponse.json(result, { status: 201 });
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
