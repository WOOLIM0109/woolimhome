import { NextResponse } from "next/server";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function kstParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: weekdays[parts.weekday],
  };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const kst = kstParts(now);
  const due = EDITORIAL_SLOTS.filter((slot) => slot.weekday === kst.weekday && slot.hour <= kst.hour);
  if (!due.length) return NextResponse.json({ skipped: true, reason: "No due slots" });

  const admin = createAdminClient();
  const created = [];
  for (const slot of due) {
    const scheduleKey = `${kst.date}-${slot.key}`;
    const scheduledAt = new Date(`${kst.date}T${String(slot.hour).padStart(2, "0")}:00:00+09:00`).toISOString();
    const title = slot.channel === "naver_design"
      ? `${slot.label} 제작 후보 · ${kst.date}`
      : `${slot.label} 주제 조사 · ${kst.date}`;
    const { data, error } = await admin.from("content_work_items").upsert({
      channel: slot.channel,
      format: slot.format,
      title,
      summary: "예약 일정에 따라 자동 생성된 작업입니다. 자료 조사와 중복 검사를 거쳐 검토 초안으로 이동합니다.",
      status: "topic_candidate",
      scheduled_at: scheduledAt,
      schedule_key: scheduleKey,
      created_by: "automation@woolimcompany.kr",
      metadata: { slotKey: slot.key, automated: true },
    }, { onConflict: "schedule_key", ignoreDuplicates: true }).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, scheduleKey }, { status: 500 });
    const workItem = data || (await admin.from("content_work_items").select("*").eq("schedule_key", scheduleKey).single()).data;
    if (workItem && slot.channel !== "homepage" && workItem.status === "topic_candidate") {
      try {
        const generated = await generateContentWorkItem(slot, scheduleKey);
        created.push(generated);
      } catch (generationError) {
        await admin.from("content_work_items").update({
          status: "on_hold",
          review_note: generationError instanceof Error ? generationError.message : "자동 생성 실패",
          updated_at: new Date().toISOString(),
        }).eq("schedule_key", scheduleKey);
        created.push({ ...workItem, status: "on_hold" });
      }
    } else if (workItem) created.push(workItem);
  }
  return NextResponse.json({ success: true, created });
}
