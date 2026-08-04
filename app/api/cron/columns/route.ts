import { NextResponse } from "next/server";
import { generateColumn } from "@/lib/columns/generate";
import { ensureInterviewRequest } from "@/lib/columns/interview-requests";
import { geminiRetryDecision } from "@/lib/gemini/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
const AUTOMATION_EMAIL = "automation@woolimcompany.kr";

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function topicHintForDay(day: number, hasKnowledge: boolean) {
  if (day === 2) return "최신 공식자료를 근거로 기업이 지금 알아야 할 정보형 주제를 선택한다. 울림의 경험을 창작하지 않는다.";
  if (day === 4) {
    return hasKnowledge
      ? "공식자료와 승인된 울림 원천자료를 함께 활용하는 하이브리드형 실무 주제를 선택한다."
      : "원천자료가 부족하므로 최신 공식자료 기반 정보형 주제를 선택한다.";
  }
  return "승인된 인터뷰·사례를 중심으로 울림의 전문성이 드러나는 노하우형 주제를 선택한다.";
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateKey = kst.toISOString().slice(0, 10);
  const { data: automationRunId, error: claimError } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "columns",
    p_schedule_key: dateKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 600,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!automationRunId) return NextResponse.json({ skipped: true, reason: "This cron date is already running or completed" });

  const completeRun = async (status: "completed" | "failed" | "skipped", metrics: Record<string, unknown>) => {
    await admin.from("content_automation_runs").update({
      status,
      metrics,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", automationRunId);
  };

  const { data: dueRetry } = await admin.from("column_generation_runs")
    .select("id,retry_count,request_payload")
    .eq("status", "failed")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", now.toISOString())
    .lt("retry_count", 7)
    .order("next_retry_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (dueRetry) {
    const retryDay = Number(dueRetry.request_payload?.day || 2);
    const { data: knowledge } = await admin.from("column_expert_knowledge")
      .select("id").eq("approved", true).lt("use_count", 3).limit(1);
    try {
      const result = await generateColumn({
        topicHint: topicHintForDay(retryDay, Boolean(knowledge?.length)),
        createdBy: AUTOMATION_EMAIL,
      });
      await admin.from("column_generation_runs").update({
        status: "generated",
        response_payload: { result, recoveredByCron: true },
        next_retry_at: null,
        last_error_code: null,
        completed_at: new Date().toISOString(),
      }).eq("id", dueRetry.id);
      await completeRun("completed", { retriedRunId: dueRetry.id, recovered: true });
      return NextResponse.json({ success: true, retried: true, result });
    } catch (error) {
      const retry = geminiRetryDecision(error, Number(dueRetry.retry_count || 0));
      await admin.from("column_generation_runs").update({
        status: "failed",
        retry_count: retry.retryCount,
        next_retry_at: retry.nextRetryAt,
        last_error_code: retry.code,
        error_message: error instanceof Error ? error.message : "Unknown error",
        completed_at: new Date().toISOString(),
      }).eq("id", dueRetry.id);
      await completeRun("failed", { retriedRunId: dueRetry.id, retry });
      return NextResponse.json({ error: "Column retry failed", retry }, { status: 503 });
    }
  }

  const day = kst.getUTCDay();
  if (![2, 4, 6].includes(day)) {
    await completeRun("skipped", { reason: "Not an editorial day" });
    return NextResponse.json({ skipped: true, reason: "Not an editorial day" });
  }
  if (day === 6 && isoWeek(kst) % 2 !== 0) {
    await completeRun("skipped", { reason: "Alternating Saturday" });
    return NextResponse.json({ skipped: true, reason: "Alternating Saturday" });
  }

  const scheduleKey = `${dateKey}-${day}`;
  const { data: existing } = await admin.from("column_generation_runs")
    .select("id").contains("request_payload", { scheduleKey }).limit(1).maybeSingle();
  if (existing) {
    await completeRun("skipped", { reason: "Already generated", scheduleKey });
    return NextResponse.json({ skipped: true, reason: "Already generated" });
  }

  const { data: knowledge } = await admin.from("column_expert_knowledge")
    .select("id, use_count").eq("approved", true).lt("use_count", 3);
  const hasKnowledge = Boolean(knowledge?.length);
  if (day === 6 && !hasKnowledge) {
    const interviewRequest = await ensureInterviewRequest({ createdBy: AUTOMATION_EMAIL });
    await completeRun("skipped", { reason: "Expert knowledge depleted" });
    return NextResponse.json({ skipped: true, reason: "Expert knowledge depleted", interviewRequest });
  }

  const runMarker = await admin.from("column_generation_runs").insert({
    status: "started",
    model: "scheduler-marker",
    request_payload: {
      scheduleKey,
      day,
      topicHint: topicHintForDay(day, hasKnowledge),
      mode: day === 2 ? "informational" : day === 4 ? "hybrid" : "authority",
    },
    created_by: AUTOMATION_EMAIL,
  }).select("id").single();
  if (runMarker.error) {
    await completeRun("failed", { error: runMarker.error.message });
    return NextResponse.json({ error: runMarker.error.message }, { status: 500 });
  }

  try {
    const result = await generateColumn({ topicHint: topicHintForDay(day, hasKnowledge), createdBy: AUTOMATION_EMAIL });
    const interviewRequest = await ensureInterviewRequest({ createdBy: AUTOMATION_EMAIL });
    await admin.from("column_generation_runs").update({
      status: "generated",
      response_payload: { result },
      retry_count: 0,
      next_retry_at: null,
      last_error_code: null,
      completed_at: new Date().toISOString(),
    }).eq("id", runMarker.data.id);
    await completeRun("completed", { scheduleKey, draftOnly: true });
    return NextResponse.json({ success: true, draftOnly: true, result, interviewRequest });
  } catch (error) {
    const retry = geminiRetryDecision(error, 0);
    await admin.from("column_generation_runs").update({
      status: "failed",
      retry_count: retry.retryCount,
      next_retry_at: retry.nextRetryAt,
      last_error_code: retry.code,
      error_message: error instanceof Error ? error.message : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", runMarker.data.id);
    await completeRun("failed", { scheduleKey, retry });
    return NextResponse.json({ error: "Column generation failed", retry }, { status: retry.retryable ? 503 : 500 });
  }
}
