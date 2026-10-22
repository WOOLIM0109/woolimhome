import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import {
  processNextPortfolioDownload,
  restorePcEligibleOversizedCandidates,
} from "@/lib/naver-works/job-runner";
import {
  processNextPortfolioMockup,
} from "@/lib/portfolio/job-runner";
import { contentAdmin } from "@/lib/content-ops/data";
import {
  generationCancellationRequested,
  removeCancelledGeneration,
} from "@/lib/content-ops/cancellation";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
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

    type PipelineJob = { job_type: string; status: string; attempts?: number; next_retry_at?: string | null; error_message?: string | null };
    let savedPipelineJobs: PipelineJob[] | null = null;
    async function readPipelineJobs() {
      if (savedPipelineJobs) return savedPipelineJobs;
      const { data, error } = await contentAdmin().from("content_jobs")
        .select("job_type,status,attempts,next_retry_at,error_message")
        .eq("candidate_id", candidateId)
        .in("job_type", ["download", "convert", "mockup", "draft"]);
      if (error) throw new Error(error.message);
      savedPipelineJobs = data || [];
      return savedPipelineJobs;
    }
    // Keep the existing download retry limit; a failed visual review has no queued download.
    const hasRetryableDownload = (jobs: PipelineJob[]) => jobs.some(job => job.job_type === "download"
      && ["queued", "failed"].includes(job.status) && Number(job.attempts || 0) < 5);
    const resumeEnqueue = activeWorkItem?.status === "on_hold" && candidateId
      ? hasRetryableDownload(await readPipelineJobs()) : false;
    if (activeWorkItem?.status === "review_required" || (activeWorkItem?.status === "on_hold" && !resumeEnqueue)) {
      return NextResponse.json({
        prepared: null,
        stage: activeWorkItem.status === "review_required" ? "review" : "on_hold",
        shouldContinue: false,
        message: `${activeWorkItem.title || "기존 포트폴리오"} 작업은 검수 필요·보류 상태로 남아 있으며 자동으로 다시 처리하지 않습니다. 작업 큐에서 사유를 확인해 주세요.`,
      });
    }

    const completedMockup = scheduleKey && !candidateId
      ? null
      : await processNextPortfolioMockup(candidateId);
    // Portfolio image conversion and mockup creation are deterministic/local.
    // Draft prose is intentionally not advanced here: only the confirmed
    // Gemini review endpoint may obtain provider-call authority.
    const portfolioProgress = completedMockup;
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    if (portfolioProgress) {
      const progressStage = "stage" in portfolioProgress && typeof portfolioProgress.stage === "string"
        ? portfolioProgress.stage
        : "";
      if (portfolioProgress.status === "creating") {
        const directRetryAt = "retryAt" in portfolioProgress ? String(portfolioProgress.retryAt || "") : "";
        const retryAt = directRetryAt || ("retry" in portfolioProgress
          && portfolioProgress.retry
          && typeof portfolioProgress.retry === "object"
          && "nextRetryAt" in portfolioProgress.retry
          ? String(portfolioProgress.retry.nextRetryAt || "")
          : "");
        return NextResponse.json({
          prepared: null,
          completedDraft: portfolioProgress,
          stage: progressStage || (retryAt ? "retry_wait" : "creating"),
          shouldContinue: !retryAt,
          message: progressStage === "design_completed"
            ? "포트폴리오 디자인 목업을 저장했습니다. 다음 단계에서 Gemini 본문만 별도로 작성합니다."
            : retryAt
              ? `디자인은 보존되며 Gemini 글쓰기만 ${retryAt} 이후 자동 재시도합니다.`
              : "진행 상황을 안전하게 저장했습니다. 같은 원본의 다음 제작 단계를 이어서 처리합니다.",
        });
      }
      if (portfolioProgress.status === "on_hold") {
        const hasReviewDraft = "title" in portfolioProgress && typeof portfolioProgress.title === "string";
        return NextResponse.json({
          prepared: null,
          completedDraft: portfolioProgress,
          stage: hasReviewDraft ? "review" : progressStage || "on_hold",
          shouldContinue: false,
          message: hasReviewDraft
            ? `${portfolioProgress.title} 초안은 준비됐지만 자동 검수 항목이 남았습니다. 관리자 화면에서 확인해 주세요.`
            : "디자인은 보존되어 있습니다. 본문 생성 보류 사유를 관리자 화면에서 확인해 주세요.",
        });
      }
      const completedTitle = "title" in portfolioProgress && typeof portfolioProgress.title === "string"
        ? portfolioProgress.title
        : activeWorkItem?.title || "포트폴리오";
      return NextResponse.json({
        prepared: null,
        completedDraft: portfolioProgress,
        stage: portfolioProgress.status === "rejected" ? "rejected" : "review",
        shouldContinue: false,
        message: portfolioProgress.status === "rejected"
          ? "실제 페이지 판정에서 포트폴리오 기준에 맞지 않아 후보를 제외했습니다. 작업은 검수 필요·보류 상태로 남으며 자동으로 다시 처리하지 않습니다. 작업 큐에서 사유를 확인해 주세요."
          : `${completedTitle} 비공개 초안을 완성했습니다. 관리자 화면에서 이미지와 본문을 검수할 수 있습니다.`,
      });
    }
    if (candidateId) {
      const pipelineJobs = await readPipelineJobs();
      const mockupJob = pipelineJobs?.find((job) => job.job_type === "mockup");
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
            ? `디자인 처리 일시 오류로 ${mockupJob.next_retry_at} 이후 자동 재시도합니다.`
            : `기존 후보의 제작 오류를 확인해 주세요: ${mockupJob.error_message || "재시도 횟수 초과"}`,
        });
      }
      if (mockupJob?.status === "completed") {
        const draftJob = pipelineJobs?.find((job) => job.job_type === "draft");
        if (draftJob?.status !== "completed") {
          return NextResponse.json({
            prepared: null,
            stage: "design_completed",
            shouldContinue: false,
            message: "디자인 목업은 완료해 보존했습니다. Gemini 본문 자동 생성과 재시도는 비용 보호 모드에서 실행하지 않습니다.",
          });
        }
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
        const conversionPending = pipelineJobs.some(job => job.job_type === "convert"
          && ["queued", "running", "pc_waiting", "pc_running"].includes(job.status));
        if (!conversionPending && !hasRetryableDownload(pipelineJobs)) {
          return NextResponse.json({
            prepared: null,
            stage: "on_hold",
            shouldContinue: false,
            message: "기존 후보가 변환 또는 자동 검수 보류 상태입니다. 자동으로 다시 처리하지 않습니다. 작업 큐에서 사유를 확인해 주세요.",
          });
        }
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
      const pcJob = (await readPipelineJobs()).find(job => job.job_type === "convert");
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
      deadlineAt: requestStartedAt + 200_000,
    });
    if (scheduleKey && await generationCancellationRequested(scheduleKey)) {
      await removeCancelledGeneration(scheduleKey);
      return NextResponse.json({
        cancelled: true, stage: "cancelled", shouldContinue: false,
        message: "포트폴리오 초안 생성을 취소했습니다.",
      });
    }
    if (!prepared.prepared) {
      // 왜 비었는지까지 알려 줍니다. "후보 자체가 없다"와 "후보는 있는데 승인된
      // 폴더의 PPT 원본이 아니다"는 사람이 해야 할 일이 완전히 다릅니다.
      return NextResponse.json({
        prepared: null,
        stage: prepared.inspectionPending ? "inspecting" : "empty",
        shouldContinue: prepared.inspectionPending === true,
        inspectedCandidates: prepared.inspected,
        eligibleCandidates: prepared.eligible,
        inspection: prepared.inspection,
        message: prepared.reason,
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
