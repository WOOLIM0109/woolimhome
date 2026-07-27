import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import { processNextPortfolioDownload } from "@/lib/naver-works/job-runner";
import { processNextPortfolioConversion } from "@/lib/cloudconvert/job-runner";
import {
  processNextPortfolioMockup,
  recoverLatestCompletedPortfolioDraft,
  retryPortfolioDraft,
} from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEST_SCHEDULE_KEY = "portfolio-pipeline-review-20260728-v2";
const ONE_TIME_TRIAL_KEY = "pf-trial-75f3e4f7-cc69-46fd-bf2d-1e3d3ad2b80d";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const cronAuthorized = Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
  const oneTimeAuthorized = request.headers.get("x-portfolio-trial-key") === ONE_TIME_TRIAL_KEY;
  if (!cronAuthorized && !oneTimeAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (oneTimeAuthorized && new URL(request.url).searchParams.get("inspect") === "1") {
    const { data, error } = await admin.from("portfolio_candidates")
      .select("id,project_name,quality_score,status,naver_works_drive_files(file_name,file_path,file_extension,file_size)")
      .eq("status", "candidate")
      .order("quality_score", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      candidates: (data || []).map((candidate) => ({
        id: candidate.id,
        projectName: candidate.project_name,
        qualityScore: candidate.quality_score,
        file: Array.isArray(candidate.naver_works_drive_files)
          ? candidate.naver_works_drive_files[0]
          : candidate.naver_works_drive_files,
      })),
    });
  }
  const { data: existing } = await admin.from("content_work_items")
    .select("id,status,metadata")
    .eq("schedule_key", TEST_SCHEDULE_KEY)
    .maybeSingle();
  if (existing?.status === "review_required" && existing.metadata?.generated?.bodyHtml) {
    return NextResponse.json({
      success: true,
      completed: true,
      workItemId: existing.id,
      message: "검수용 포트폴리오 초안이 이미 완성되었습니다.",
    });
  }
  if (
    existing?.status === "on_hold"
    && existing.metadata?.portfolioReview?.suitable
    && existing.metadata?.portfolioAssets?.length
  ) {
    const retried = await retryPortfolioDraft(existing.id);
    if (retried) {
      return NextResponse.json({
        success: true,
        completed: retried.status === "review_required",
        progress: [retried],
      });
    }
  }
  if (existing?.status === "on_hold") {
    const { data: failedConversion } = await admin.from("content_jobs")
      .select("error_message")
      .eq("work_item_id", existing.id)
      .eq("job_type", "convert")
      .eq("status", "failed")
      .maybeSingle();
    if (failedConversion?.error_message?.includes("conversion credits")) {
      const recovered = await recoverLatestCompletedPortfolioDraft(existing.id);
      if (recovered) {
        return NextResponse.json({
          success: true,
          completed: recovered.status === "review_required",
          recovered: true,
          progress: [recovered],
        });
      }
    }
  }

  let candidateId = existing?.metadata?.candidateId as string | undefined;
  const progress: unknown[] = [];
  if (candidateId) {
    const mockup = await processNextPortfolioMockup(candidateId);
    if (mockup) {
      progress.push(mockup);
      if (mockup.status === "review_required") {
        return NextResponse.json({ success: true, completed: true, progress });
      }
      if (mockup.status === "rejected") candidateId = undefined;
    }
  }

  if (candidateId) {
    const downloaded = await processNextPortfolioDownload(candidateId);
    if (downloaded) progress.push(downloaded);
    const converted = await processNextPortfolioConversion(candidateId);
    if (converted) {
      progress.push(converted);
      if (converted.status === "completed") {
        const mockup = await processNextPortfolioMockup(candidateId);
        if (mockup) progress.push(mockup);
      }
    }
    const { data: active } = await admin.from("content_jobs")
      .select("id,status,job_type")
      .eq("candidate_id", candidateId)
      .in("status", ["queued", "running", "pc_waiting", "pc_running"])
      .limit(1);
    if (active?.length || progress.length) {
      return NextResponse.json({ success: true, completed: false, candidateId, progress, active: active?.[0] || null });
    }
  }

  const prepared = await prepareNextPortfolioCandidate({
    scheduleKey: TEST_SCHEDULE_KEY,
    scheduledAt: new Date().toISOString(),
  });
  if (!prepared) {
    return NextResponse.json({
      success: false,
      completed: false,
      message: "시험할 새 프로젝트 후보가 없습니다.",
      progress,
    });
  }
  const downloaded = await processNextPortfolioDownload(prepared.candidateId);
  const converted = downloaded
    ? await processNextPortfolioConversion(prepared.candidateId)
    : null;
  return NextResponse.json({
    success: true,
    completed: false,
    prepared,
    downloaded,
    converted,
    progress,
  });
}
