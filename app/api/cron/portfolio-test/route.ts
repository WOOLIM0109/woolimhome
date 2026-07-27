import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import { processNextPortfolioDownload } from "@/lib/naver-works/job-runner";
import { processNextPortfolioConversion } from "@/lib/cloudconvert/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEST_SCHEDULE_KEY = "portfolio-pipeline-review-20260728";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
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
