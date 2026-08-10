import { NextResponse } from "next/server";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import {
  processNextPortfolioDownload,
  restorePcEligibleOversizedCandidates,
} from "@/lib/naver-works/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const maxDuration = 300;

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
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
    const mockup = await processNextPortfolioMockup();
    if (mockup) localProgress.push(mockup);
    if (!mockup) {
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
    if (workItem) scheduled.push(workItem);
  }

  const completedAt = new Date().toISOString();
  const metrics = {
    code: "GEMINI_COST_PROTECTION_ACTIVE",
    aiCalls: 0,
    localProgress,
    scheduledCount: scheduled.length,
    skippedAiStages: ["content_generation", "style_retry", "portfolio_draft"],
  };
  await admin.from("content_automation_runs").update({
    status: "completed",
    metrics,
    completed_at: completedAt,
    updated_at: completedAt,
  }).eq("id", runId);
  return NextResponse.json({ success: true, scheduled, ...metrics });
}
