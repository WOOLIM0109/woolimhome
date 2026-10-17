import { contentAdmin } from "@/lib/content-ops/data";
import { readPortfolioDedupeInventory } from "@/lib/portfolio/dedupe-inventory";
import { PORTFOLIO_DEDUPE_VERSION } from "@/lib/portfolio/project-dedupe";
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
  const { data: control, error: controlError } = await admin.from("portfolio_automation_control").select("*").eq("id", true).single();
  if (controlError) throw new Error(controlError.message);
  if (!control.first_run_approved) return { prepared: false, inspected: 0, eligible: 0, reason: "기존 보류 정리와 후보 미리보기 확인 후 첫 제작 승인이 필요합니다." };
  const inventory = await readPortfolioDedupeInventory(control.hash_threshold);
  const decision = selectPortfolioCandidate(inventory.accepted);
  for (const check of inventory.decisions) {
    if (check.candidate.id === decision.selected?.candidate.id) continue;
    const row = check.candidate as CandidateRow & { updated_at: string };
    const { error } = await admin.from("portfolio_candidates").update({
      duplicate_score: check.duplicateScore,
      updated_at: new Date().toISOString(),
      ...(check.match || check.fontExclusionReason ? { status: "excluded", exclusion_reasons: [check.reason] } : {}),
      metadata: { ...row.metadata, normalizedProjectName: check.normalizedName,
        fontExclusionReason: check.fontExclusionReason,
        fontReviewReason: inventory.needsFontReview.some(candidate => candidate.id === row.id) ? "검수 필요: 변환 전 원본 글꼴 확인 필요" : null,
        imageReviewReason: check.reason || (inventory.needsImageReview.some(candidate => candidate.id === row.id) ? "대표 이미지 해시를 확인할 수 없어 제작 전 검수가 필요합니다." : null),
        ...(check.match ? { duplicateMatch: check.match } : {}) },
    }).eq("id", row.id).eq("status", "candidate").eq("updated_at", row.updated_at);
    if (error) throw new Error(error.message);
  }
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
      reason: inventory.sourceFailures.length && !inventory.decisions.length
        ? `원본 확인 실패: 후보 ${inventory.sourceFailures.length}건을 모두 제외했습니다.` : decision.reason,
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
  const { data: existingItem, error: existingItemError } = await admin.from("content_work_items").select("id").eq("schedule_key", scheduleKey).maybeSingle();
  if (existingItemError) throw new Error(existingItemError.message);
  if (existingItem) return { prepared: false, inspected: decision.inspected, eligible: decision.eligible, reason: "이 일정에 이미 작업이 있어 보존했습니다." };
  const inspected = inventory.decisions.find(check => check.candidate.id === candidate.id)!;
  const workPayload = {
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
      sourceInspectionMetrics: inventory.metrics,
    },
    updated_at: new Date().toISOString(),
  };
  const { data: workItemId, error: reservationError } = await admin.rpc("reserve_deduplicated_portfolio_candidate", {
    p_id: candidate.id, p_updated_at: (candidate as CandidateRow & { updated_at: string }).updated_at,
    p_normalized_name: inspected.normalizedName,
    p_metadata: { ...candidate.metadata, normalizedProjectName: inspected.normalizedName,
      dedupeVersion: PORTFOLIO_DEDUPE_VERSION, selectionScore: selected.score, shortlist,
      duplicateScore: inspected.duplicateScore, selectionReasons: selected.reasons },
    p_work_item: workPayload,
  });
  if (reservationError) throw new Error(reservationError.message);
  if (!workItemId) return { prepared: false, inspected: decision.inspected, eligible: decision.eligible,
    reason: "다른 실행에서 같은 프로젝트 또는 일정을 먼저 선택했습니다." };

  return {
    prepared: true,
    inspected: decision.inspected,
    eligible: decision.eligible,
    candidateId: candidate.id,
    workItemId,
    projectName: candidate.project_name,
    score: selected.score,
    shortlistCount: shortlist.length,
  };
}
