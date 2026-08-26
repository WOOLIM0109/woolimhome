import { NextResponse } from "next/server";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import {
  processNextPortfolioDownload,
  restorePcEligibleOversizedCandidates,
} from "@/lib/naver-works/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import type { EditorialSlot } from "@/lib/content-ops/types";
import { authorizeCron } from "@/lib/cron-auth";
import { GENERATION_BUDGET_MS, isDeadlineError } from "@/lib/content-ops/deadline";
import { sweepStuckWorkItems } from "@/lib/content-ops/stuck-items";
import { appendStatusChange } from "@/lib/content-ops/status-history";

/**
 * 예약 일정에 맞춰 원고까지 자동으로 만들지 여부.
 *
 * 예전에는 크론에서 AI를 전혀 부르지 않았습니다. 그때는 지출 상한이 없어서
 * 자동 생성이 곧 요금 폭탄이었기 때문입니다.
 * 지금은 월·일 상한과 사용량 기록이 있어, 상한이 브레이크 역할을 합니다.
 * 상한을 넘으면 생성을 건너뛰고 다음 시간에 다시 시도합니다.
 *
 * 끄고 싶으면 환경변수 CONTENT_AUTO_GENERATION 을 false 로 두면 됩니다.
 * 자동으로 만드는 것은 원고까지입니다. 발행은 어떤 경우에도 사람이 합니다.
 */
function autoGenerationEnabled() {
  return process.env.CONTENT_AUTO_GENERATION !== "false";
}

/**
 * 한 번 도는 동안 만들 원고 수.
 *
 * 크론은 매시간 돌기 때문에 한 편씩만 만들어도 하루 스물몇 편까지 소화됩니다.
 * 한 번에 여러 편을 만들면 5분 실행 제한에 걸려 중간에 끊깁니다.
 * 밀린 양이 많아 더 빨리 당기고 싶으면 환경변수로 올릴 수 있습니다.
 */
const AUTO_GENERATION_PER_RUN = Math.max(
  1,
  Math.min(3, Number(process.env.CONTENT_AUTO_GENERATION_PER_RUN) || 1),
);
/** 같은 자리에서 실패를 반복하며 예산을 태우지 않도록 시도 횟수를 제한합니다. */
const AUTO_GENERATION_MAX_ATTEMPTS = 2;

export const maxDuration = 300;

/**
 * 한 번 실행에서 쓸 수 있는 전체 시간. 함수 상한보다 조금 짧게 잡아 둡니다.
 * 상한에 정확히 맞추면 마무리 기록을 남기기 전에 죽습니다.
 */
const RUN_BUDGET_MS = 280_000;

/*
 * 원고 생성 몫은 lib/content-ops/deadline.ts 의 GENERATION_BUDGET_MS 를 그대로 씁니다.
 *
 * 예전에는 목업 처리가 앞에서 최대 240초를 쓰고, 남은 시간으로 원고를 만들었습니다.
 * 그래서 원고 생성이 시작하자마자 함수가 죽는 일이 반복됐습니다. 요금은 나가고
 * 글은 안 나오고, 작업 항목만 어중간하게 남았습니다.
 *
 * 원고는 발행 일정이 걸려 있어 미루면 그날 글이 빕니다. 목업은 다음 시간에
 * 이어서 해도 됩니다. 그래서 원고 몫을 먼저 떼고, 목업은 남은 시간만 씁니다.
 * 값을 한곳에 두는 이유는, 단계별 예산과 어긋나면 한 편도 못 만들기 때문입니다.
 */

/** 한 번 실행에서 이어 처리할 목업 최대 건수. 남은 시간이 없으면 그 전에 멈춥니다. */
const MOCKUPS_PER_RUN = 4;

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

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;
  const admin = createAdminClient();
  const now = new Date();
  const invocationKey = now.toISOString().slice(0, 13);
  const { data: runId, error: claimError } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "content-operations",
    p_schedule_key: invocationKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 600,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!runId) return NextResponse.json({ skipped: true, reason: "This cron window is already recorded" });

  const runStartedAt = Date.now();
  const runDeadlineAt = runStartedAt + RUN_BUDGET_MS;
  const localProgress: unknown[] = [];

  /**
   * 중간에 죽어 굳은 항목부터 풀어 줍니다. AI 를 부르지 않아 거의 시간이 안 듭니다.
   * 이걸 먼저 해야 '제작 중'인 채로 영영 남는 항목이 쌓이지 않습니다.
   */
  try {
    const swept = await sweepStuckWorkItems(now);
    if (swept) localProgress.push(swept);
  } catch (error) {
    localProgress.push({
      stage: "stuck_sweep",
      status: "failed",
      error: error instanceof Error ? error.message : "멈춘 항목 정리 실패",
    });
  }

  // Keep deterministic scheduling and portfolio preparation alive. Only the
  // prose generation/rewrite stages are forbidden in the background.
  const kst = kstParts(now);
  const currentKoreaDate = new Date(`${kst.date}T00:00:00Z`);
  const due = EDITORIAL_SLOTS
    .filter((slot) => slot.weekday === kst.weekday && slot.hour <= kst.hour)
    .filter((slot) => slot.key !== "home-sat" || isoWeek(currentKoreaDate) % 2 === 0);
  const scheduled: unknown[] = [];
  /** 자동 생성 시도를 다 써서 사람 손이 필요한 자리. */
  const exhausted: { id: string; scheduleKey: string; metadata: unknown }[] = [];
  const autoTargets: {
    slot: EditorialSlot;
    scheduleKey: string;
    workItem: { id: string; status: string; metadata: unknown };
    attempts: number;
  }[] = [];
  for (const slot of due) {
    const scheduleKey = `${kst.date}-${slot.key}`;
    const scheduledAt = new Date(
      `${kst.date}T${String(slot.hour).padStart(2, "0")}:00:00+09:00`,
    ).toISOString();
    if (slot.channel === "naver_design" && slot.format === "portfolio") {
      const { data: existingPortfolio, error: existingError } = await admin
        .from("content_work_items")
        .select("id,status,metadata")
        .eq("schedule_key", scheduleKey)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      const existingCandidateId = typeof existingPortfolio?.metadata?.candidateId === "string"
        ? existingPortfolio.metadata.candidateId
        : null;
      if (existingCandidateId) {
        const { data: candidate, error: candidateError } = await admin
          .from("portfolio_candidates")
          .select("status")
          .eq("id", existingCandidateId)
          .maybeSingle();
        if (candidateError) throw new Error(candidateError.message);
        if (candidate?.status !== "excluded") {
          const downloaded = await processNextPortfolioDownload(existingCandidateId);
          if (downloaded) localProgress.push(downloaded);
          scheduled.push(existingPortfolio);
          continue;
        }
      }
      try {
        const prepared = await prepareNextPortfolioCandidate({ scheduleKey, scheduledAt });
        if (prepared.prepared) {
          scheduled.push(prepared);
          const downloaded = await processNextPortfolioDownload(prepared.candidateId);
          if (downloaded) localProgress.push(downloaded);
        } else {
          /*
           * 고를 후보가 없었다는 사실도 기록으로 남깁니다.
           *
           * 예전에는 여기에 else 가 없었습니다. 그래서 후보가 마른 채로 화·금
           * 여섯 회차가 지나도록 실행 기록에는 아무 흔적이 없었고, 22 일 뒤에야
           * 사람이 눈치챘습니다. 성공했을 때만 적고 빈손일 때 침묵하면,
           * 정작 알아야 할 때 아무것도 안 보입니다.
           */
          localProgress.push({
            stage: "deterministic_portfolio_prepare",
            status: "skipped",
            slotKey: slot.key,
            scheduleKey,
            inspectedCandidates: prepared.inspected,
            eligibleCandidates: prepared.eligible,
            reason: prepared.reason,
          });
        }
      } catch (error) {
        localProgress.push({
          stage: "deterministic_portfolio_prepare",
          status: "failed",
          error: error instanceof Error ? error.message : "포트폴리오 후보 준비 실패",
        });
      }
      continue;
    }

    const title = slot.channel === "naver_design"
      ? `${slot.label} 제작 후보 · ${kst.date}`
      : `${slot.label} 주제 조사 · ${kst.date}`;
    const { data, error } = await admin.from("content_work_items").upsert({
      channel: slot.channel,
      format: slot.format,
      title,
      summary: "예약 일정에 따라 생성된 작업입니다. AI 검수는 관리자 확인 후에만 실행됩니다.",
      status: "topic_candidate",
      scheduled_at: scheduledAt,
      schedule_key: scheduleKey,
      created_by: "automation@woolimcompany.kr",
      metadata: appendStatusChange(
        { slotKey: slot.key, automated: true, awaitingAiConfirmation: true },
        "topic_candidate",
        "automation@woolimcompany.kr",
        scheduledAt,
      ),
    }, { onConflict: "schedule_key", ignoreDuplicates: true }).select().maybeSingle();
    if (error) throw new Error(error.message);
    const workItem = data || (await admin.from("content_work_items")
      .select("*").eq("schedule_key", scheduleKey).single()).data;
    if (workItem) {
      scheduled.push(workItem);
      // 아직 원고가 없는 자리만 자동 생성 대상으로 모읍니다.
      if (workItem.status === "topic_candidate" && slot.channel !== "homepage") {
        const attempts = Number(
          (workItem.metadata as Record<string, unknown> | null)?.autoGenerationAttempts || 0,
        );
        if (attempts < AUTO_GENERATION_MAX_ATTEMPTS) {
          autoTargets.push({ slot, scheduleKey, workItem, attempts });
        } else {
          // 시도를 다 쓴 자리를 그냥 건너뛰면 아무 일도 일어나지 않은 것처럼
          // 보입니다. 그날 글이 왜 비었는지 알 길이 없어집니다. 보류로 올려
          // 검토 목록에 보이게 합니다.
          exhausted.push({ id: workItem.id, scheduleKey, metadata: workItem.metadata });
        }
      }
    }
  }

  /**
   * 예약된 자리에 실제 원고를 만듭니다.
   *
   * 상한을 넘으면 GeminiAutomationBlocked 로 멈추고 다음 시간에 다시 시도합니다.
   * 만들어진 원고는 검토요청으로 들어가며, 발행은 사람이 승인해야 진행됩니다.
   */
  /**
   * 지난 날짜에 만들어져 아직 원고가 없는 자리도 함께 당겨옵니다.
   *
   * 오늘 예약분만 처리하면 그동안 쌓인 '주제 후보'는 영원히 그대로 남습니다.
   * 오래된 것부터 한 편씩 채워 나가며, 상한에 걸리면 다음 시간에 이어서 합니다.
   */
  if (autoGenerationEnabled() && autoTargets.length < AUTO_GENERATION_PER_RUN) {
    const { data: backlog } = await admin
      .from("content_work_items")
      .select("id,channel,format,status,schedule_key,scheduled_at,metadata")
      .eq("status", "topic_candidate")
      .in("channel", ["naver_consulting", "naver_design"])
      .neq("format", "portfolio")
      .not("schedule_key", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    for (const item of backlog || []) {
      if (autoTargets.length >= AUTO_GENERATION_PER_RUN) break;
      if (autoTargets.some((target) => target.workItem.id === item.id)) continue;
      const metadata = (item.metadata || {}) as Record<string, unknown>;
      const attempts = Number(metadata.autoGenerationAttempts || 0);
      if (attempts >= AUTO_GENERATION_MAX_ATTEMPTS) continue;
      const configured = EDITORIAL_SLOTS.find((slot) => slot.key === metadata.slotKey);
      const scheduledDate = item.scheduled_at ? new Date(item.scheduled_at) : now;
      const slot: EditorialSlot = configured || {
        key: item.schedule_key as string,
        channel: item.channel as EditorialSlot["channel"],
        format: item.format as EditorialSlot["format"],
        weekday: scheduledDate.getDay(),
        hour: scheduledDate.getHours(),
        label: "밀린 예약 자리",
      };
      autoTargets.push({
        slot,
        scheduleKey: item.schedule_key as string,
        workItem: { id: item.id, status: item.status, metadata: item.metadata },
        attempts,
      });
    }
  }

  /**
   * 시도를 다 쓴 자리를 보류로 올립니다.
   *
   * 예전에는 조용히 건너뛰었습니다. 그래서 그날 글이 왜 비었는지 화면 어디에도
   * 나오지 않았고, 아침에 사람이 하나하나 눌러 보고서야 알았습니다.
   */
  for (const item of exhausted) {
    await admin.from("content_work_items").update({
      status: "on_hold",
      metadata: appendStatusChange(item.metadata, "on_hold", "automation@woolimcompany.kr"),
      review_note: `자동 생성을 ${AUTO_GENERATION_MAX_ATTEMPTS}번 시도했지만 만들지 못했습니다. `
        + "직접 만들거나, 주제를 정해 다시 시도해 주세요.",
      updated_at: new Date().toISOString(),
    }).eq("id", item.id).eq("status", "topic_candidate");
  }

  const autoGeneration: unknown[] = [];
  let aiCalls = 0;
  if (autoGenerationEnabled()) {
    for (const target of autoTargets.slice(0, AUTO_GENERATION_PER_RUN)) {
      await admin.from("content_work_items").update({
        metadata: {
          ...((target.workItem.metadata as Record<string, unknown> | null) || {}),
          autoGenerationAttempts: target.attempts + 1,
          autoGenerationStartedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", target.workItem.id);
      try {
        const result = await runBudgetedGeminiAutomation({
          operation: "cron-content-generate",
          actor: "cron",
          // 주제 기획 + 후보별 조사 + 본문 생성
          plannedCalls: 6,
        }, () => generateContentWorkItem(target.slot, target.scheduleKey, {
          // 원고 몫으로 떼어 둔 시간 안에서만 씁니다. 한 단계를 끝낼 만큼
          // 남지 않았으면 부르지 않고 멈춥니다.
          deadlineAt: Math.min(runDeadlineAt, runStartedAt + GENERATION_BUDGET_MS),
        }));
        aiCalls += 6;
        autoGeneration.push({ scheduleKey: target.scheduleKey, status: "generated", result });
      } catch (error) {
        const blocked = error instanceof GeminiAutomationBlocked;
        /**
         * 시간이 모자라 시작조차 하지 않은 것은 실패가 아닙니다.
         *
         * 이걸 실패로 세면 두 번 미뤄진 것만으로 그 자리가 영영 건너뛰어집니다.
         * 그러면 아침마다 사람이 손으로 돌려야 하고, 손으로 돌려도 같은 자리에서
         * 또 걸립니다. 시도 횟수를 되돌려 다음 시간에 다시 잡게 합니다.
         */
        const deferred = isDeadlineError(error);
        // 미뤘다고 해서 요금이 0 이라는 뜻은 아닙니다. 앞 단계(주제·조사)를
        // 지나 본문 앞에서 멈췄다면 거기까지는 이미 부른 뒤입니다.
        // 사실이 아닌 말을 적어 두면 나중에 요금을 볼 때 서로 어긋납니다.
        const message = deferred
          ? "이번 실행에 남은 시간이 모자라 다음 시간으로 미뤘습니다."
          : (error instanceof Error ? error.message : "자동 생성 실패");
        autoGeneration.push({
          scheduleKey: target.scheduleKey,
          status: blocked ? "budget_blocked" : (deferred ? "deferred" : "failed"),
          reason: message,
        });
        // 상한이나 시간 때문에 멈춘 것이면 시도 횟수를 되돌려 다음 기회를 남깁니다.
        if (blocked || deferred) {
          await admin.from("content_work_items").update({
            metadata: {
              ...((target.workItem.metadata as Record<string, unknown> | null) || {}),
              autoGenerationAttempts: target.attempts,
              autoGenerationBlockedReason: message,
            },
            updated_at: new Date().toISOString(),
          }).eq("id", target.workItem.id);
          break;
        }
        await admin.from("content_work_items").update({
          status: "on_hold",
          metadata: appendStatusChange(
            target.workItem.metadata,
            "on_hold",
            "automation@woolimcompany.kr",
          ),
          review_note: `자동 생성 보류: ${message}`,
          updated_at: new Date().toISOString(),
        }).eq("id", target.workItem.id);
      }
    }
  }

  /**
   * 목업과 내려받기는 원고를 만들고 남은 시간으로 합니다.
   *
   * 예전에는 이 블록이 맨 앞에 있었고 최대 240초까지 썼습니다. 그러면 원고
   * 생성은 시작하자마자 함수 상한에 걸려 죽었습니다. 요금은 나가고 글은
   * 안 나왔습니다. 목업은 다음 시간에 이어서 해도 되지만, 원고는 그날
   * 발행이 걸려 있어 미루면 그대로 빕니다. 그래서 순서를 바꿨습니다.
   */
  try {
    const restoredCandidates = await restorePcEligibleOversizedCandidates();
    if (restoredCandidates) localProgress.push({ stage: "pc_direct_restore", restoredCandidates });
    let processedMockups = 0;
    let lastMockup: unknown = null;
    while (processedMockups < MOCKUPS_PER_RUN && Date.now() < runDeadlineAt) {
      const mockup = await processNextPortfolioMockup(undefined, { deadlineAt: runDeadlineAt });
      if (!mockup) break;
      localProgress.push(mockup);
      lastMockup = mockup;
      processedMockups += 1;
    }
    if (!lastMockup && Date.now() < runDeadlineAt) {
      const download = await processNextPortfolioDownload();
      if (download) localProgress.push(download);
    }
  } catch (error) {
    localProgress.push({
      stage: "local_portfolio_processing",
      status: "failed",
      error: error instanceof Error ? error.message : "로컬 포트폴리오 처리 실패",
    });
  }

  const completedAt = new Date().toISOString();
  const metrics = {
    code: autoGenerationEnabled() ? "CONTENT_AUTO_GENERATION_ON" : "GEMINI_COST_PROTECTION_ACTIVE",
    aiCalls,
    localProgress,
    scheduledCount: scheduled.length,
    autoGeneration,
    exhaustedCount: exhausted.length,
    // 문체 재작성과 포트폴리오 본문은 여전히 사람이 눌러야 시작합니다.
    skippedAiStages: ["style_retry", "portfolio_draft"],
  };
  await admin.from("content_automation_runs").update({
    status: "completed",
    metrics,
    completed_at: completedAt,
    updated_at: completedAt,
  }).eq("id", runId);
  return NextResponse.json({ success: true, scheduled, ...metrics });
}
