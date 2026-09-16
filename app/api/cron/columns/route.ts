import { NextResponse } from "next/server";
import { generateColumn } from "@/lib/columns/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import { ensureInterviewRequest } from "@/lib/columns/interview-requests";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COLUMN_CATCHUP_LOOKBACK_DAYS,
  columnCatchupCount,
  dueColumnDates,
  isoWeek,
} from "@/lib/columns/catchup";
import { authorizeCron } from "@/lib/cron-auth";

// 칼럼 본문 생성은 몇 분이 걸립니다. 30초로는 만들다가 끊깁니다.
export const maxDuration = 300;

/** 함수 상한보다 조금 짧게 잡습니다. 정확히 맞추면 마무리 기록 전에 죽습니다. */
const RUN_BUDGET_MS = 280_000;

/** 칼럼 한 편에 잡아 두는 시간. 이만큼 남지 않으면 새로 시작하지 않습니다. */
const COLUMN_BUDGET_MS = 130_000;
const AUTOMATION_EMAIL = "automation@woolimcompany.kr";

/**
 * 이 회차를 어떤 형식으로 쓸지 정합니다. 무엇을 쓸지는 정하지 않습니다.
 * 주제는 generateColumn 안의 주제 기획이 주제군을 돌려 가며 고릅니다.
 */
function formatHintForDay(day: number, hasKnowledge: boolean) {
  if (day === 2) return "최신 공식자료 기반 정보형 주제";
  if (day === 4) return hasKnowledge ? "공식자료와 승인 원천자료를 결합한 실무 주제" : "최신 공식자료 기반 정보형 주제";
  return "승인된 인터뷰·사례 기반 노하우 주제";
}

export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;
  const admin = createAdminClient();
  const now = new Date();
  const runDeadlineAt = Date.now() + RUN_BUDGET_MS;
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

  /**
   * 지난 일주일에 놓친 회차를 셉니다.
   *
   * 크론은 하루 한 번만 돌고, 그날 실패하면 그 회차는 그대로 사라졌습니다.
   * 실제로 두 편이 그렇게 없어졌습니다. 이제 다음 회차에서 한 편씩 채웁니다.
   * 사람이 직접 쓴 글도 나온 것으로 세므로, 손으로 채웠으면 다시 만들지 않습니다.
   */
  async function countMissedColumns() {
    if (process.env.COLUMN_CATCHUP === "false") return 0;
    const dueDates = dueColumnDates(kst, COLUMN_CATCHUP_LOOKBACK_DAYS);
    if (!dueDates.length) return 0;
    // 오늘 만든 글은 세지 않습니다. 세면 어제까지 빠진 회차가 가려집니다.
    const since = new Date(now.getTime() - COLUMN_CATCHUP_LOOKBACK_DAYS * 86_400_000);
    const until = new Date(`${dateKey}T00:00:00+09:00`);
    const { count, error: countError } = await admin.from("column_posts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString())
      .lt("created_at", until.toISOString());
    if (countError) return 0;
    return columnCatchupCount(dueDates.length, Number(count || 0));
  }

  const scheduleKey = `${dateKey}-${day}`;
  /**
   * 이미 만든 회차인지 봅니다.
   *
   * 기록은 만들기 '시작할 때' 남습니다. 그래서 중간에 함수가 죽으면 started
   * 상태의 기록만 남고, 다음부터는 이 자리가 '이미 처리됨'으로 보였습니다.
   * 그 날짜의 칼럼은 영영 만들어지지 않았고, 화면에는 아무 이유도 남지
   * 않았습니다. 실제로 그렇게 사라진 회차가 있습니다.
   *
   * 그래서 끝난 기록만 처리된 것으로 셉니다. started 인 채로 오래 묵은 것은
   * 죽은 것으로 보고 다시 시도합니다.
   */
  const { data: existingRuns, error: existingError } = await admin.from("column_generation_runs")
    .select("id,status,created_at")
    .contains("request_payload", { scheduleKey })
    .order("created_at", { ascending: false })
    .limit(5);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  const deadRunCutoff = now.getTime() - 20 * 60_000;
  const existing = (existingRuns || []).find((run) => (
    run.status !== "started" || Date.parse(run.created_at) > deadRunCutoff
  )) || null;

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

  const formatHint = formatHintForDay(day, hasKnowledge);

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
      request_payload: { scheduleKey, day, formatHint, awaitingAiConfirmation: true },
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

  const writeOne = (hint: string, key: string) => runBudgetedGeminiAutomation({
    operation: "cron-column-generate",
    actor: "cron",
    // 주제 기획 1 + 조사 1 + 작성 1 + 응답 실패 시 1 + 분량 미달 시 1 + 문체 2
    plannedCalls: 7,
  }, () => generateColumn({
    formatHint: hint,
    createdBy: AUTOMATION_EMAIL,
    scheduleKey: key,
  }));

  try {
    const result = await writeOne(formatHint, scheduleKey);
    // 오늘 것을 만든 뒤, 지난주에 빠진 회차가 있으면 한 편만 더 채웁니다.
    let caughtUp = 0;
    let catchupReason = "";
    /**
     * 한 편을 더 쓸 시간이 남았을 때만 시작합니다.
     *
     * 예전에는 시간을 보지 않고 곧바로 두 번째를 시작했습니다. 첫 편이
     * 오래 걸린 날에는 두 번째가 함수 상한에 걸려 죽었고, 그러면 방금 만든
     * 첫 편의 마무리 기록까지 같이 날아갔습니다.
     */
    const remainingMs = runDeadlineAt - Date.now();
    if (remainingMs < COLUMN_BUDGET_MS) {
      catchupReason = "이번 실행에 남은 시간이 모자라 밀린 회차는 다음으로 미뤘습니다.";
    } else if (await countMissedColumns() > 0) {
      try {
        await writeOne(formatHint, `${scheduleKey}-catchup`);
        caughtUp = 1;
      } catch (catchupError) {
        catchupReason = catchupError instanceof Error
          ? catchupError.message
          : "밀린 칼럼을 채우지 못했습니다.";
      }
    }
    const metrics = {
      code: "COLUMN_AUTO_GENERATION_ON",
      aiCalls: 6 + caughtUp * 6,
      scheduleKey,
      interviewRequest,
      caughtUp,
      catchupReason,
      blocked: Boolean(result?.blocked),
      reason: result?.blocked
        ? "초안을 만들었으나 검증에서 보류되었습니다."
        : "칼럼 초안을 생성했습니다.",
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
