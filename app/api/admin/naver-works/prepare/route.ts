import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import {
  processNextPortfolioDownload,
  restorePcEligibleOversizedCandidates,
} from "@/lib/naver-works/job-runner";
import { processNextPortfolioMockup } from "@/lib/portfolio/job-runner";
import { contentAdmin } from "@/lib/content-ops/data";
import {
  generationCancellationRequested,
  removeCancelledGeneration,
} from "@/lib/content-ops/cancellation";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    await restorePcEligibleOversizedCandidates();
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
      ? body.requestId
      : null;
    const scheduleKey = requestId ? `manual-portfolio-${requestId}` : null;

    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true,
        stage: "cancelled",
        shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }

    let candidateId: string | undefined;
    if (scheduleKey) {
      const { data: active } = await contentAdmin()
        .from("content_work_items")
        .select("metadata")
        .eq("schedule_key", scheduleKey)
        .maybeSingle();
      candidateId = typeof active?.metadata?.candidateId === "string"
        ? active.metadata.candidateId
        : undefined;
    }

    const completedDraft = scheduleKey && !candidateId
      ? null
      : await processNextPortfolioMockup(candidateId);
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    if (completedDraft) {
      return NextResponse.json({
        prepared: null,
        completedDraft,
        stage: completedDraft.status === "rejected" ? "rejected" : "review",
        shouldContinue: completedDraft.status === "rejected",
        message: completedDraft.status === "rejected"
          ? "실제 페이지를 확인한 결과 포트폴리오 기준에 맞지 않아 자동 제외했습니다. 다음 후보를 이어서 확인합니다."
          : `${completedDraft.title} 비공개 초안을 완성했습니다. 관리자 화면에서 이미지와 본문을 검수할 수 있습니다.`,
      });
    }
    const resumedDownload = scheduleKey && !candidateId
      ? null
      : await processNextPortfolioDownload(candidateId);
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    if (resumedDownload) {
      return NextResponse.json({
        prepared: null,
        downloaded: resumedDownload,
        stage: "pc_waiting",
        shouldContinue: true,
        message: `${resumedDownload.originalFileName} 원본을 회사 PC 직접 처리 대기열로 이동했습니다.`,
      });
    }
    if (candidateId) {
      const { data: pcJob } = await contentAdmin().from("content_jobs")
        .select("status")
        .eq("candidate_id", candidateId)
        .eq("job_type", "convert")
        .maybeSingle();
      if (pcJob?.status === "pc_waiting" || pcJob?.status === "pc_running") {
        return NextResponse.json({
          prepared: null,
          stage: pcJob.status,
          shouldContinue: true,
          message: pcJob.status === "pc_running"
            ? "회사 PC가 원본을 직접 내려받아 변환하고 있습니다."
            : "회사 PC가 원본을 직접 처리할 차례를 기다리고 있습니다.",
        });
      }
    }
    const prepared = await prepareNextPortfolioCandidate({
      scheduleKey: scheduleKey || undefined,
    });
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    if (!prepared) {
      return NextResponse.json({
        prepared: null,
        stage: "empty",
        shouldContinue: false,
        message: "현재 자동 기준을 통과한 새 디자인 프로젝트 후보가 없습니다.",
      });
    }
    const downloaded = await processNextPortfolioDownload(prepared.candidateId);
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    return NextResponse.json({
      prepared,
      downloaded,
      stage: "selected",
      shouldContinue: true,
      message: `${prepared.projectName} 프로젝트를 비공개 제작 작업으로 등록하고 회사 PC 직접 처리 대기열로 이동했습니다.`,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "포트폴리오 준비 실패",
    }, { status: 500 });
  }
}
