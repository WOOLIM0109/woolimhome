import { NextResponse } from "next/server";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import {
  processNextPortfolioDownload,
  restorePcEligibleOversizedCandidates,
} from "@/lib/naver-works/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";
import { shouldGenerateScheduledItem } from "@/lib/partner-portal";
import { geminiRetryDecision } from "@/lib/gemini/client";

export const maxDuration = 300;
const MAX_PORTFOLIO_SELECTION_ATTEMPTS = 5;

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
  const { data: automationRunId, error: claimError } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: "content-operations",
    p_schedule_key: invocationKey,
    p_scheduled_for: now.toISOString(),
    p_lease_seconds: 600,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!automationRunId) {
    return NextResponse.json({ skipped: true, reason: "This cron window is already running or completed" });
  }

  const portfolioProgress: unknown[] = [];
  try {
    const restoredCandidates = await restorePcEligibleOversizedCandidates();
    if (restoredCandidates) {
      portfolioProgress.push({
        stage: "pc_direct_restore",
        status: "completed",
        restoredCandidates,
      });
    }
    const completedDraft = await processNextPortfolioMockup();
    if (completedDraft) portfolioProgress.push(completedDraft);
    if (!completedDraft || completedDraft.status === "rejected") {
      const downloaded = await processNextPortfolioDownload();
      if (downloaded) portfolioProgress.push(downloaded);
    }
  } catch (portfolioError) {
    portfolioProgress.push({
      stage: "background_portfolio",
      status: "failed",
      error: portfolioError instanceof Error ? portfolioError.message : "포트폴리오 자동 처리 실패",
    });
  }
  const kst = kstParts(now);
  const retried: unknown[] = [];
  const { data: retryItems, error: retryReadError } = await admin
    .from("content_work_items")
    .select("id,schedule_key,channel,format,retry_count,metadata")
    .eq("status", "on_hold")
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", now.toISOString())
    .lt("retry_count", 7)
    .order("next_retry_at", { ascending: true })
    .limit(3);
  if (retryReadError) {
    await admin.from("content_automation_runs").update({
      status: "failed",
      error_code: "RETRY_READ_FAILED",
      error_message: retryReadError.message,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", automationRunId);
    return NextResponse.json({ error: retryReadError.message }, { status: 500 });
  }
  for (const item of retryItems || []) {
    const slotKey = typeof item.metadata?.slotKey === "string" ? item.metadata.slotKey : null;
    const slot = EDITORIAL_SLOTS.find((entry) => entry.key === slotKey)
      || EDITORIAL_SLOTS.find((entry) => entry.channel === item.channel && entry.format === item.format);
    if (!slot || slot.channel === "homepage" || !item.schedule_key) continue;
    try {
      const generated = await generateContentWorkItem(slot, item.schedule_key);
      await admin.from("content_work_items").update({
        retry_count: 0,
        next_retry_at: null,
        last_error_code: null,
        last_error_context: {},
      }).eq("id", item.id);
      retried.push({ id: item.id, success: true, generated });
    } catch (retryError) {
      const decision = geminiRetryDecision(retryError, Number(item.retry_count || 0));
      await admin.from("content_work_items").update({
        status: "on_hold",
        retry_count: decision.retryCount,
        next_retry_at: decision.nextRetryAt,
        last_error_code: decision.code,
        last_error_context: { source: "cron_retry", at: new Date().toISOString() },
        review_note: retryError instanceof Error ? retryError.message : "자동 재시도 실패",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      retried.push({ id: item.id, success: false, retry: decision });
    }
  }
  const currentKoreaDate = new Date(`${kst.date}T00:00:00Z`);
  const due = EDITORIAL_SLOTS
    .filter((slot) => slot.weekday === kst.weekday && slot.hour <= kst.hour)
    .filter((slot) => slot.key !== "home-sat" || isoWeek(currentKoreaDate) % 2 === 0);
  if (!due.length) {
    await admin.from("content_automation_runs").update({
      status: "completed",
      metrics: { retried, portfolioProgress },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", automationRunId);
    return NextResponse.json({
      skipped: !portfolioProgress.length && !retried.length,
      reason: "No due editorial slots",
      portfolioProgress,
      retried,
    });
  }

  const created = [];
  for (const slot of due) {
    const scheduleKey = `${kst.date}-${slot.key}`;
    const scheduledAt = new Date(`${kst.date}T${String(slot.hour).padStart(2, "0")}:00:00+09:00`).toISOString();
    if (slot.channel === "naver_design" && slot.format === "portfolio") {
      const { data: existingPortfolio } = await admin.from("content_work_items")
        .select("id,status,metadata")
        .eq("schedule_key", scheduleKey)
        .maybeSingle();
      if (existingPortfolio && existingPortfolio.metadata?.candidateId) {
        const existingCandidateId = String(existingPortfolio.metadata.candidateId);
        const { data: existingCandidate } = await admin.from("portfolio_candidates")
          .select("status")
          .eq("id", existingCandidateId)
          .maybeSingle();
        if (existingCandidate?.status !== "excluded") {
          if (existingPortfolio.status !== "on_hold") {
            created.push(existingPortfolio);
            continue;
          }
          try {
            const pcHandoff = await processNextPortfolioDownload(existingCandidateId);
            if (pcHandoff) portfolioProgress.push(pcHandoff);
            created.push(existingPortfolio);
            continue;
          } catch (portfolioError) {
            portfolioProgress.push({
              stage: "held_portfolio_retry",
              status: "failed",
              error: portfolioError instanceof Error ? portfolioError.message : "보류 포트폴리오 재처리 실패",
            });
            created.push(existingPortfolio);
            continue;
          }
        }
      }
      for (let attempt = 0; attempt < MAX_PORTFOLIO_SELECTION_ATTEMPTS; attempt += 1) {
        try {
          const prepared = await prepareNextPortfolioCandidate({
            scheduleKey,
            scheduledAt,
          });
          if (!prepared) break;
          portfolioProgress.push(prepared);
          const downloaded = await processNextPortfolioDownload(prepared.candidateId);
          if (downloaded) portfolioProgress.push(downloaded);
          created.push(prepared);
          break;
        } catch (portfolioError) {
          portfolioProgress.push({
            stage: "scheduled_portfolio",
            status: "failed",
            attempt: attempt + 1,
            error: portfolioError instanceof Error ? portfolioError.message : "포트폴리오 자동 처리 실패",
          });
          break;
        }
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
      summary: "예약 일정에 따라 자동 생성된 작업입니다. 자료 조사와 중복 검사를 거쳐 검토 초안으로 이동합니다.",
      status: "topic_candidate",
      scheduled_at: scheduledAt,
      schedule_key: scheduleKey,
      created_by: "automation@woolimcompany.kr",
      metadata: { slotKey: slot.key, automated: true },
    }, { onConflict: "schedule_key", ignoreDuplicates: true }).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, scheduleKey }, { status: 500 });
    const workItem = data || (await admin.from("content_work_items").select("*").eq("schedule_key", scheduleKey).single()).data;
    if (workItem && slot.channel !== "homepage" && shouldGenerateScheduledItem(workItem)) {
      try {
        const generated = await generateContentWorkItem(slot, scheduleKey);
        created.push(generated);
      } catch (generationError) {
        const decision = geminiRetryDecision(generationError, Number(workItem.retry_count || 0));
        await admin.from("content_work_items").update({
          status: "on_hold",
          review_note: generationError instanceof Error ? generationError.message : "자동 생성 실패",
          retry_count: decision.retryCount,
          next_retry_at: decision.nextRetryAt,
          last_error_code: decision.code,
          last_error_context: { source: "scheduled_generation", at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq("schedule_key", scheduleKey);
        created.push({ ...workItem, status: "on_hold" });
      }
    } else if (workItem) created.push(workItem);
  }
  await admin.from("content_automation_runs").update({
    status: "completed",
    metrics: { createdCount: created.length, retried, portfolioProgress },
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", automationRunId);
  return NextResponse.json({ success: true, created, portfolioProgress, retried });
}
