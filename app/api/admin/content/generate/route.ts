import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import type { EditorialSlot } from "@/lib/content-ops/types";
import {
  generationCancellationRequested,
  removeCancelledGeneration,
} from "@/lib/content-ops/cancellation";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  // 컨설팅 블로그 글도 예약 일정을 기다리지 않고 지금 만들 수 있어야 합니다.
  // 예약 항목을 지우면 새 글을 만들 방법이 아예 없어지는 문제가 있었습니다.
  const channel = body.channel === "naver_consulting" ? "naver_consulting" : "naver_design";
  const format = channel === "naver_consulting"
    ? (body.format === "authority" ? "authority" : "informational")
    : (body.format === "portfolio" ? "portfolio" : "design_insight");
  const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
    ? body.requestId
    : crypto.randomUUID();
  const scheduleKey = channel === "naver_consulting"
    ? `manual-consulting-${requestId}`
    : `manual-design-${requestId}`;
  const label = channel === "naver_consulting"
    ? (format === "authority" ? "컨설팅 울림 콘텐츠형" : "컨설팅 정보형")
    : "디자인 블로그 시험 초안";
  const slot: EditorialSlot = { key: scheduleKey, channel, format, weekday: new Date().getDay(), hour: new Date().getHours(), label };
  const { error } = await contentAdmin().from("content_work_items").upsert({
    channel: slot.channel, format: slot.format, title: `${label} 생성 중`, summary: "공식 자료를 확인하고 초안을 생성하고 있습니다.",
    status: "creating", schedule_key: scheduleKey, created_by: user.email,
    metadata: { manual: true, manualRequestId: requestId },
  }, { onConflict: "schedule_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    return NextResponse.json({
      cancelled: true,
      error: `${label} 초안 생성을 취소했습니다.`,
    }, { status: 409 });
  }
  try {
    // 예산 관문을 통과해야만 실제 호출이 일어납니다.
    // 상한을 넘었거나 GEMINI_ENABLED가 꺼져 있으면 여기서 멈춥니다.
    return NextResponse.json(await runBudgetedGeminiAutomation({
      operation: "content-generate",
      actor: user.email || "admin",
      // 주제 기획 + 후보별 조사와 본문 생성
      plannedCalls: 6,
    }, () => generateContentWorkItem(slot, scheduleKey)));
  } catch (generationError) {
    if (generationError instanceof GeminiAutomationBlocked) {
      await contentAdmin().from("content_work_items")
        .update({ status: "on_hold", review_note: generationError.message })
        .eq("schedule_key", scheduleKey);
      return NextResponse.json({
        error: generationError.message,
        code: generationError.code,
      }, { status: 409 });
    }
    const message = generationError instanceof Error ? generationError.message : "자동 생성 실패";
    if (message === "GENERATION_CANCELLED") {
      return NextResponse.json({
        cancelled: true,
        error: `${label} 초안 생성을 취소했습니다.`,
      }, { status: 409 });
    }
    await contentAdmin().from("content_work_items").update({ status: "on_hold", review_note: message }).eq("schedule_key", scheduleKey);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
