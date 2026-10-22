import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";
import { processNextPortfolioDownload } from "@/lib/naver-works/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const requestId = body && typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
    ? body.requestId : null;
  if (!requestId) return NextResponse.json({ error: "유효한 제작 요청 번호가 필요합니다." }, { status: 400 });
  const { id } = await context.params;
  const scheduleKey = `manual-portfolio-${requestId}`;
  try {
    // Replays resume through prepare with the same request ID; never queue twice.
    const { data: existing, error } = await contentAdmin().from("content_work_items")
      .select("id,title,status,metadata").eq("schedule_key", scheduleKey)
      .eq("channel", "naver_design").eq("format", "portfolio").maybeSingle();
    if (error) throw new Error(error.message);
    if (existing) {
      if (existing.metadata?.candidateId !== id) return NextResponse.json({
        error: "이 요청 번호는 다른 후보의 제작에 사용되었습니다.",
      }, { status: 409 });
      let shouldContinue = ["researching", "creating", "draft_waiting"].includes(existing.status);
      if (!shouldContinue && existing.status === "on_hold") {
        const { data: downloadJob, error: downloadError } = await contentAdmin().from("content_jobs")
          .select("status,attempts").eq("candidate_id", id).eq("job_type", "download").maybeSingle();
        if (downloadError) throw new Error(downloadError.message);
        shouldContinue = Boolean(downloadJob && ["queued", "failed"].includes(downloadJob.status)
          && Number(downloadJob.attempts || 0) < 5);
      }
      return NextResponse.json({
        requestId, stage: "existing", shouldContinue,
        candidateId: id, workItemId: existing.id,
        message: `${existing.title || "포트폴리오"} 기존 제작 작업을 이어갑니다.`,
      });
    }
    // confirmNotPublished and note cannot replace image evidence in task 4-1.
    const prepared = await prepareNextPortfolioCandidate({ candidateId: id, scheduleKey, deadlineAt: startedAt + 200_000 });
    if (!prepared.prepared) return NextResponse.json({
      error: prepared.reason, message: prepared.reason, inspection: prepared.inspection,
      duplicateMatch: prepared.duplicateMatch, stage: "blocked", shouldContinue: false,
    }, { status: 409 });
    const downloaded = await processNextPortfolioDownload(prepared.candidateId);
    return NextResponse.json({
      prepared, downloaded, requestId, stage: "selected", shouldContinue: true,
      message: `${prepared.projectName} 프로젝트를 비공개 제작 작업으로 등록하고 회사 PC 직접 처리 대기열로 이동했습니다.`,
    });
  } catch {
    return NextResponse.json({ error: "후보 제작 준비 중 오류가 발생했습니다. 관리자 화면에서 상태를 확인한 뒤 다시 시도해 주세요." }, { status: 500 });
  }
}
