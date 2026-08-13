import { NextResponse } from "next/server";
import { generateColumn } from "@/lib/columns/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import { ensureInterviewRequest } from "@/lib/columns/interview-requests";
import { createAdminClient } from "@/lib/supabase/admin";

// 칼럼 본문 생성은 몇 분이 걸립니다. 30초로는 만들다가 끊깁니다.
export const maxDuration = 300;
const AUTOMATION_EMAIL = "automation@woolimcompany.kr";

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function topicHintForDay(day: number, hasKnowledge: boolean) {
  if (day === 2) return "최신 공식자료 기반 정보형 주제";
  if (day === 4) return hasKnowledge ? "공식자료와 승인 원천자료를 결합한 실무 주제" : "최신 공식자료 기반 정보형 주제";
  return "승인된 인터뷰·사례 기반 노하우 주제";
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  const dateKey = kst.toISOString().slice(0, 10);
  const { data: runId, error } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "columns",
    p_schedule_key: dateKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 60,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!runId) return NextResponse.json({ skipped: true, reason: "This cron date is already recorded" });
  const completeRun = async (status: "completed" | "skipped", metrics: Record<string, unknown>) => {
    const completedAt = new Date().toISOString();
    await admin.from("content_automation_runs").update({
      status,
      metrics,
      completed_at: completedAt,
      lease_expires_at: completedAt,
      updated_at: completedAt,
    }).eq("id", runId);
  };

  const day = kst.getUTCDay();
  if (![2, 4, 6].includes(day)) {
    await completeRun("skipped", { aiCalls: 0, reason: "Not an editorial day" });
    return NextResponse.json({ skipped: true, aiCalls: 0, reason: "Not an editorial day" });
  }
  if (day === 6 && isoWeek(kst) % 2 !== 0) {
    await completeRun("skipped", { aiCalls: 0, reason: "Alternating Saturday" });
    return NextResponse.json({ skipped: true, aiCalls: 0, reason: "Alternating Saturday" });
  }

  const scheduleKey = `${dateKey}-${day}`;
  const { data: existing, error: existingError } = await admin.from("column_generation_runs")
    .select("id").contains("request_payload", { scheduleKey }).limit(1).maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const { data: knowledge, error: knowledgeError } = await admin.from("column_expert_knowledge")
    .select("id,use_count").eq("approved", true).lt("use_count", 3);
  if (knowledgeError) return NextResponse.json({ error: knowledgeError.message }, { status: 500 });
  const hasKnowledge = Boolean(knowledge?.length);
  const interviewRequest = await ensureInterviewRequest({ createdBy: AUTOMATION_EMAIL });

  if (existing) {
    await completeRun("skipped", { aiCalls: 0, reason: "Already scheduled", scheduleKey, interviewRequest });
    return NextResponse.json({ skipped: true, aiCalls: 0, reason: "Already scheduled", interviewRequest });
  }
  if (day === 6 && !hasKnowledge) {
    await completeRun("skipped", { aiCalls: 0, reason: "Expert knowledge depleted", interviewRequest });
    return NextResponse.json({ skipped: true, aiCalls: 0, reason: "Expert knowledge depleted", interviewRequest });
  }

  const topicHint = topicHintForDay(day, hasKnowledge);

  /**
   * 칼럼 초안을 실제로 만듭니다.
   *
   * 예전에는 일정만 적어 두고 AI를 부르지 않아, 칼럼이 한 편도 자동으로 나오지 않았습니다.
   * 지금은 월·일 지출 상한이 있으므로 상한을 브레이크로 삼아 생성까지 진행합니다.
   * 상한에 걸리면 기록만 남기고 다음 일정에 다시 시도합니다.
   * 만들어진 초안은 검토 대기로 들어가며, 발행은 사람이 확인한 뒤에 합니다.
   *
   * 끄고 싶으면 환경변수 COLUMN_AUTO_GENERATION 을 false 로 두면 됩니다.
   */
  if (process.env.COLUMN_AUTO_GENERATION === "false") {
    const marker = await admin.from("column_generation_runs").insert({
      status: "blocked",
      model: "cost-protection-deterministic-scheduler",
      request_payload: { scheduleKey, day, topicHint, awaitingAiConfirmation: true },
      response_payload: { code: "COLUMN_AUTO_GENERATION_OFF", aiCalls: 0 },
      created_by: AUTOMATION_EMAIL,
      completed_at: new Date().toISOString(),
    }).select("id").single();
    if (marker.error) return NextResponse.json({ error: marker.error.message }, { status: 500 });
    const metrics = {
      code: "COLUMN_AUTO_GENERATION_OFF",
      aiCalls: 0,
      scheduleKey,
      markerId: marker.data.id,
      interviewRequest,
      reason: "자동 생성이 꺼져 있어 일정만 준비했습니다.",
    };
    await completeRun("completed", metrics);
    return NextResponse.json({ success: true, ...metrics });
  }

  try {
    const result = await runBudgetedGeminiAutomation({
      operation: "cron-column-generate",
      actor: "cron",
      // 조사 1회 + 본문 생성 1회 + 분량 미달 시 재생성 1회
      plannedCalls: 3,
    }, () => generateColumn({
      topicHint,
      createdBy: AUTOMATION_EMAIL,
    }));
    const metrics = {
      code: "COLUMN_AUTO_GENERATION_ON",
      aiCalls: 3,
      scheduleKey,
      interviewRequest,
      blocked: Boolean(result?.blocked),
      reason: result?.blocked ? "초안을 만들었으나 검증에서 보류되었습니다." : "칼럼 초안을 생성했습니다.",
    };
    await completeRun("completed", metrics);
    return NextResponse.json({ success: true, ...metrics });
  } catch (error) {
    const budgetBlocked = error instanceof GeminiAutomationBlocked;
    const message = error instanceof Error ? error.message : "칼럼 자동 생성 실패";
    const metrics = {
      code: budgetBlocked ? "GEMINI_BUDGET_EXCEEDED" : "COLUMN_AUTO_GENERATION_FAILED",
      aiCalls: 0,
      scheduleKey,
      interviewRequest,
      reason: message,
    };
    await completeRun("skipped", metrics);
    return NextResponse.json({ skipped: true, ...metrics });
  }
}
