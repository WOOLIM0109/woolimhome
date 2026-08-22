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

  const localProgress: unknown[] = [];
  try {
    const restoredCandidates = await restorePcEligibleOversizedCandidates();
    if (restoredCandidates) localProgress.push({ stage: "pc_direct_restore", restoredCandidates });
    /**
     * 밀린 목업을 한 번에 여러 건 처리합니다.
     *
     * 예전에는 한 번 실행에 한 건만 집어갔습니다. 크론이 한 시간에 한 번 도니
     * 여섯 건을 다시 만들면 여섯 시간이 걸렸습니다. 실제로 그랬습니다.
     * 첫 건은 예전과 똑같이 넉넉한 시간을 쓰고, 시간이 남을 때만 다음 건을 잇습니다.
     */
    const mockupStartedAt = Date.now();
    const mockupDeadlineAt = mockupStartedAt + 240_000;
    let processedMockups = 0;
    let lastMockup: unknown = null;
    while (processedMockups < MOCKUPS_PER_RUN) {
      const mockup = processedMockups === 0
        ? await processNextPortfolioMockup()
        : await processNextPortfolioMockup(undefined, { deadlineAt: mockupDeadlineAt });
      if (!mockup) break;
      localProgress.push(mockup);
      lastMockup = mockup;
      processedMockups += 1;
      // 남은 시간이 한 건을 더 끝낼 만큼 없으면 다음 실행으로 넘깁니다.
      if (Date.now() - mockupStartedAt > 120_000) break;
    }
    if (!lastMockup) {
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

  // Keep deterministic scheduling and portfolio preparation alive. Only the
  // prose generation/rewrite stages are forbidden in the background.
  const kst = kstParts(now);
  const currentKoreaDate = new Date(`${kst.date}T00:00:00Z`);
  const due = EDITORIAL_SLOTS
    .filter((slot) => slot.weekday === kst.weekday && slot.hour <= kst.hour)
    .filter((slot) => slot.key !== "home-sat" || isoWeek(currentKoreaDate) % 2 === 0);
  const scheduled: unknown[] = [];
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
        if (prepared) {
          scheduled.push(prepared);
          const downloaded = await processNextPortfolioDownload(prepared.candidateId);
          if (downloaded) localProgress.push(downloaded);
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
      metadata: { slotKey: slot.key, automated: true, awaitingAiConfirmation: true },
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
        }, () => generateContentWorkItem(target.slot, target.scheduleKey));
        aiCalls += 6;
        autoGeneration.push({ scheduleKey: target.scheduleKey, status: "generated", result });
      } catch (error) {
        const blocked = error instanceof GeminiAutomationBlocked;
        const message = error instanceof Error ? error.message : "자동 생성 실패";
        autoGeneration.push({
          scheduleKey: target.scheduleKey,
          status: blocked ? "budget_blocked" : "failed",
          reason: message,
        });
        // 상한 때문에 멈춘 것이면 시도 횟수를 되돌려 다음 기회를 남깁니다.
        if (blocked) {
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
          review_note: `자동 생성 보류: ${message}`,
          updated_at: new Date().toISOString(),
        }).eq("id", target.workItem.id);
      }
    }
  }

  const completedAt = new Date().toISOString();
  const metrics = {
    code: autoGenerationEnabled() ? "CONTENT_AUTO_GENERATION_ON" : "GEMINI_COST_PROTECTION_ACTIVE",
    aiCalls,
    localProgress,
    scheduledCount: scheduled.length,
    autoGeneration,
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
