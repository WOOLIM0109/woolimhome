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
    let activeWorkItem: { title?: string; status?: string; metadata?: Record<string, unknown> } | null = null;
    if (scheduleKey) {
      const { data: active } = await contentAdmin()
        .from("content_work_items")
        .select("title,status,metadata")
        .eq("schedule_key", scheduleKey)
        .maybeSingle();
      activeWorkItem = active;
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
      if (completedDraft.status === "creating") {
        const directRetryAt = "retryAt" in completedDraft ? String(completedDraft.retryAt || "") : "";
        const retryAt = directRetryAt || ("retry" in completedDraft
          && completedDraft.retry
          && typeof completedDraft.retry === "object"
          && "nextRetryAt" in completedDraft.retry
          ? String(completedDraft.retry.nextRetryAt || "")
          : "");
        return NextResponse.json({
          prepared: null,
          completedDraft,
          stage: retryAt ? "retry_wait" : "creating",
          shouldContinue: !retryAt,
          message: retryAt
            ? `Gemini 일시 오류로 ${retryAt} 이후 자동으로 이어서 제작합니다.`
            : "진행 상황을 안전하게 저장했습니다. 같은 원본의 다음 제작 단계를 이어서 처리합니다.",
        });
      }
      if (completedDraft.status === "on_hold") {
        const hasReviewDraft = "title" in completedDraft && typeof completedDraft.title === "string";
        return NextResponse.json({
          prepared: null,
          completedDraft,
          stage: hasReviewDraft ? "review" : "on_hold",
          shouldContinue: false,
          message: hasReviewDraft
            ? `${completedDraft.title} 초안은 준비됐지만 자동 검수 항목이 남았습니다. 관리자 화면에서 확인해 주세요.`
            : "Gemini 재시도 한도를 초과했거나 자동 제작 검수를 통과하지 못했습니다. 관리자 화면에서 사유를 확인해 주세요.",
        });
      }
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
    if (candidateId) {
      const { data: mockupJob } = await contentAdmin().from("content_jobs")
        .select("status,next_retry_at,error_message")
        .eq("candidate_id", candidateId)
        .eq("job_type", "mockup")
        .maybeSingle();
      if (mockupJob?.status === "queued" || mockupJob?.status === "running") {
        return NextResponse.json({
          prepared: null,
          stage: "creating",
          shouldContinue: true,
          message: mockupJob.status === "running"
            ? "같은 원본의 포트폴리오 목업과 초안을 제작하고 있습니다."
            : "저장된 체크포인트부터 포트폴리오 제작을 이어갈 준비가 되었습니다.",
        });
      }
      if (mockupJob?.status === "failed") {
        const waitingForRetry = Boolean(
          mockupJob.next_retry_at && new Date(mockupJob.next_retry_at).getTime() > Date.now()
        );
        return NextResponse.json({
          prepared: null,
          stage: waitingForRetry ? "retry_wait" : "on_hold",
          shouldContinue: false,
          message: waitingForRetry
            ? `Gemini 일시 오류로 ${mockupJob.next_retry_at} 이후 자동 재시도합니다.`
            : `기존 후보의 제작 오류를 확인해 주세요: ${mockupJob.error_message || "재시도 횟수 초과"}`,
        });
      }
      if (mockupJob?.status === "completed") {
        return NextResponse.json({
          prepared: null,
          stage: activeWorkItem?.status === "on_hold" ? "on_hold" : "review",
          shouldContinue: false,
          message: activeWorkItem?.status === "on_hold"
            ? "기존 포트폴리오 초안이 자동 검수 보류 상태입니다. 관리자 화면에서 사유를 확인해 주세요."
            : `${activeWorkItem?.title || "기존 포트폴리오"} 비공개 초안이 이미 준비되어 있습니다.`,
        });
      }
      if (mockupJob?.status === "on_hold") {
        return NextResponse.json({
          prepared: null,
          stage: "on_hold",
          shouldContinue: false,
          message: "기존 후보가 변환 또는 자동 검수 보류 상태입니다. 관리자 화면에서 사유를 확인해 주세요.",
        });
      }
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
