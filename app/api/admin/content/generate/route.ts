import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
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
  const format = body.format === "portfolio" ? "portfolio" : "design_insight";
  const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
    ? body.requestId
    : crypto.randomUUID();
  const scheduleKey = `manual-design-${requestId}`;
  const slot: EditorialSlot = { key: scheduleKey, channel: "naver_design", format, weekday: new Date().getDay(), hour: new Date().getHours(), label: "디자인 블로그 시험 초안" };
  const { error } = await contentAdmin().from("content_work_items").upsert({
    channel: slot.channel, format: slot.format, title: "디자인 블로그 시험 초안 생성 중", summary: "공식 자료를 확인하고 초안을 생성하고 있습니다.",
    status: "creating", schedule_key: scheduleKey, created_by: user.email,
    metadata: { manual: true, manualRequestId: requestId },
  }, { onConflict: "schedule_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (await generationCancellationRequested(scheduleKey)) {
    await removeCancelledGeneration(scheduleKey);
    return NextResponse.json({
      cancelled: true,
      error: "디자인 인사이트 초안 생성을 취소했습니다.",
    }, { status: 409 });
  }
  try {
    return NextResponse.json(await generateContentWorkItem(slot, scheduleKey));
  } catch (generationError) {
    const message = generationError instanceof Error ? generationError.message : "자동 생성 실패";
    if (message === "GENERATION_CANCELLED") {
      return NextResponse.json({
        cancelled: true,
        error: "디자인 인사이트 초안 생성을 취소했습니다.",
      }, { status: 409 });
    }
    await contentAdmin().from("content_work_items").update({ status: "on_hold", review_note: message }).eq("schedule_key", scheduleKey);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
