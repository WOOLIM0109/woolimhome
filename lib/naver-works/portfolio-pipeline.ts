import { contentAdmin } from "@/lib/content-ops/data";
import {
  type CandidateRow,
  type PortfolioPrepareResult,
  driveFile,
  selectPortfolioCandidate,
} from "./portfolio-selection.ts";

export type { CandidateRow, PortfolioPrepareResult } from "./portfolio-selection.ts";
export {
  deterministicShortlist,
  explorationScore,
  metadataEligible,
  projectScore,
  selectPortfolioCandidate,
  sourcePreference,
} from "./portfolio-selection.ts";

export async function prepareNextPortfolioCandidate(options: {
  scheduleKey?: string;
  scheduledAt?: string;
} = {}): Promise<PortfolioPrepareResult> {
  const admin = contentAdmin();
  const { data, error } = await admin.from("portfolio_candidates")
    .select(`
      id,project_key,project_name,quality_score,status,metadata,
      naver_works_drive_files!inner(id,file_name,file_path,file_extension,file_size,root_id,modified_at)
    `)
    .eq("status", "candidate")
    .limit(500);
  if (error) throw new Error(error.message);

  const decision = selectPortfolioCandidate((data || []) as CandidateRow[]);
  const { selected, shortlist } = decision;
  /*
   * 고르지 못했으면 왜 못 골랐는지 알려 줍니다.
   *
   * 예전에는 그냥 null 만 돌아왔고, 부르는 쪽에도 else 가 없어서 아무 기록이
   * 남지 않았습니다. 그래서 후보가 마른 채로 22 일이 지나도록 아무도 몰랐습니다.
   */
  if (!selected) {
    return {
      prepared: false,
      inspected: decision.inspected,
      eligible: decision.eligible,
      reason: decision.reason,
    };
  }

  const candidate = selected.candidate;
  const file = driveFile(candidate);
  if (!file) {
    return {
      prepared: false,
      inspected: decision.inspected,
      eligible: decision.eligible,
      reason: "고른 후보에 연결된 드라이브 파일 정보가 없습니다.",
    };
  }
  const scheduleKey = options.scheduleKey || `naver-works-portfolio-${candidate.id}`;

  const { data: workItem, error: workError } = await admin.from("content_work_items").upsert({
    channel: "naver_design",
    format: "portfolio",
    title: candidate.project_name,
    summary: "NAVER WORKS에서 1차 선별한 디자인 프로젝트입니다. 실제 페이지 판정, 민감정보 처리, 목업 합성, 본문 작성을 순서대로 진행합니다.",
    status: "researching",
    source_label: "NAVER WORKS 공용 폴더",
    source_reference: file.file_path || file.file_name,
    scheduled_at: options.scheduledAt || null,
    schedule_key: scheduleKey,
    created_by: "automation@woolimcompany.kr",
    metadata: {
      candidateId: candidate.id,
      driveFileId: file.id,
      sourceFileName: file.file_name,
      sourcePath: file.file_path,
      pipeline: ["download", "convert", "font_check", "privacy_check", "mockup", "draft"],
      selectionScore: selected.score,
      selectionReasons: selected.reasons,
      shortlist: shortlist.map((item) => ({
        candidateId: item.id,
        confidence: item.confidence,
        reasons: item.reasons,
      })),
      automated: true,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "schedule_key" }).select("id").single();
  if (workError) throw new Error(workError.message);

  const { error: candidateError } = await admin.from("portfolio_candidates").update({
    status: "selected",
    quality_score: Math.min(99, selected.score),
    selection_reasons: selected.reasons.length
      ? selected.reasons
      : ["파일명·경로 기준 1차 후보 선별", "실제 페이지 시각 판정 대기"],
    metadata: {
      ...(candidate.metadata || {}),
      workItemId: workItem.id,
      selectedAt: new Date().toISOString(),
      selectionScore: selected.score,
      shortlist,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", candidate.id);
  if (candidateError) throw new Error(candidateError.message);

  const steps = ["download", "convert", "font_check", "privacy_check", "mockup", "draft"] as const;
  const { data: existingJobs, error: existingError } = await admin.from("content_jobs")
    .select("job_type")
    .eq("candidate_id", candidate.id);
  if (existingError) throw new Error(existingError.message);
  const existing = new Set((existingJobs || []).map((job) => job.job_type));
  const jobs = steps.filter((step) => !existing.has(step)).map((step, index) => ({
    candidate_id: candidate.id,
    work_item_id: workItem.id,
    job_type: step,
    status: index === 0 ? "queued" : "on_hold",
    payload: {
      stepOrder: index + 1,
      waitsFor: index ? steps[index - 1] : null,
      driveFileId: file.id,
    },
  }));
  if (jobs.length) {
    const { error: jobsError } = await admin.from("content_jobs").insert(jobs);
    if (jobsError) throw new Error(jobsError.message);
  }

  return {
    prepared: true,
    inspected: decision.inspected,
    eligible: decision.eligible,
    candidateId: candidate.id,
    workItemId: workItem.id,
    projectName: candidate.project_name,
    score: selected.score,
    shortlistCount: shortlist.length,
  };
}
