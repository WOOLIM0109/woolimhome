import { NextResponse } from "next/server";
import { generateColumn } from "@/lib/columns/generate";
import { ensureInterviewRequest } from "@/lib/columns/interview-requests";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (![2, 4, 6].includes(day)) return NextResponse.json({ skipped: true, reason: "Not an editorial day" });
  if (day === 6 && isoWeek(kst) % 2 !== 0) return NextResponse.json({ skipped: true, reason: "Alternating Saturday" });

  const admin = createAdminClient();
  const dateKey = kst.toISOString().slice(0, 10);
  const scheduleKey = `${dateKey}-${day}`;
  const { data: existing } = await admin
    .from("column_generation_runs")
    .select("id")
    .contains("request_payload", { scheduleKey })
    .limit(1)
    .maybeSingle();
  if (existing) return NextResponse.json({ skipped: true, reason: "Already generated" });

  const { data: knowledge } = await admin
    .from("column_expert_knowledge")
    .select("id, use_count")
    .eq("approved", true)
    .lt("use_count", 3);
  const hasKnowledge = Boolean(knowledge?.length);
  if (day === 6 && !hasKnowledge) {
    const interviewRequest = await ensureInterviewRequest({
      createdBy: "automation@woolimcompany.kr",
    });
    return NextResponse.json({ skipped: true, reason: "Expert knowledge depleted", interviewRequest });
  }

  const topicHint = day === 2
    ? "최신 공식자료를 근거로 기업이 지금 알아야 할 정보형 주제를 선택한다. 울림의 경험을 창작하지 않는다."
    : day === 4
      ? hasKnowledge
        ? "공식자료와 승인된 울림 원천자료를 함께 활용하는 하이브리드형 실무 주제를 선택한다."
        : "원천자료가 부족하므로 최신 공식자료 기반 정보형 주제를 선택한다."
      : "승인된 인터뷰·사례를 중심으로 울림의 전문성이 드러나는 노하우형 주제를 선택한다.";

  const runMarker = await admin.from("column_generation_runs").insert({
    status: "started",
    model: "scheduler-marker",
    request_payload: { scheduleKey, day, mode: day === 2 ? "informational" : day === 4 ? "hybrid" : "authority" },
    created_by: "automation@woolimcompany.kr",
  }).select("id").single();
  if (runMarker.error) return NextResponse.json({ error: runMarker.error.message }, { status: 500 });

  try {
    const result = await generateColumn({ topicHint, createdBy: "automation@woolimcompany.kr" });
    const interviewRequest = await ensureInterviewRequest({
      createdBy: "automation@woolimcompany.kr",
    });
    await admin.from("column_generation_runs").update({
      status: "generated",
      response_payload: { result },
      completed_at: new Date().toISOString(),
    }).eq("id", runMarker.data.id);
    return NextResponse.json({ success: true, draftOnly: true, result, interviewRequest });
  } catch (error) {
    await admin.from("column_generation_runs").update({
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", runMarker.data.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generation failed" }, { status: 500 });
  }
}
