import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import type { EditorialSlot } from "@/lib/content-ops/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const format = body.format === "portfolio" ? "portfolio" : "design_insight";
  const scheduleKey = `manual-design-${Date.now()}`;
  const slot: EditorialSlot = { key: scheduleKey, channel: "naver_design", format, weekday: new Date().getDay(), hour: new Date().getHours(), label: "디자인 블로그 시험 초안" };
  const { error } = await contentAdmin().from("content_work_items").insert({
    channel: slot.channel, format: slot.format, title: "디자인 블로그 시험 초안 생성 중", summary: "공식 자료를 확인하고 초안을 생성하고 있습니다.",
    status: "creating", schedule_key: scheduleKey, created_by: user.email, metadata: { manual: true },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    return NextResponse.json(await generateContentWorkItem(slot, scheduleKey));
  } catch (generationError) {
    const message = generationError instanceof Error ? generationError.message : "자동 생성 실패";
    await contentAdmin().from("content_work_items").update({ status: "on_hold", review_note: message }).eq("schedule_key", scheduleKey);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
