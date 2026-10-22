import { contentAdmin } from "@/lib/content-ops/data";
import { readPortfolioDedupeInventory } from "@/lib/portfolio/dedupe-inventory";
import { portfolioFontExclusion } from "@/lib/portfolio/font-policy";
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

const ACTIVE_PORTFOLIO_STATUSES = ["researching", "creating", "draft_waiting"];
const RESERVATION_SCOPE = "portfolio-reservation";
const RESERVATION_KEY = "single-active-portfolio";

async function activePortfolioReason() {
  const { data, error } = await contentAdmin().from("content_work_items")
    .select("id,title,status")
    .eq("channel", "naver_design").eq("format", "portfolio")
    .in("status", ACTIVE_PORTFOLIO_STATUSES).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? `진행 중인 포트폴리오 작업이 있습니다: ${data.title || "제목 없음"}. 기존 작업을 먼저 확인해 주세요.` : null;
}

/**
 * The existing reservation RPC serializes duplicate checks, but does not reject
 * a different active project. Reuse the existing atomic lease RPC around the
 * active-work check and reservation for every manual/automatic portfolio path.
 * A one-hour lease exceeds the 300-second route lifetime; a crashed request
 * therefore fails closed until the bounded lease expires. No schema is added.
 */
async function withReservationLease<T>(reserve: () => Promise<T>): Promise<T | null> {
  const admin = contentAdmin();
  const { data: leaseId, error } = await admin.rpc("claim_content_automation_run", {
    p_cron_name: RESERVATION_SCOPE,
    p_schedule_key: RESERVATION_KEY,
    p_scheduled_for: new Date().toISOString(),
    p_lease_seconds: 3600,
  });
  if (error) throw new Error(error.message);
  if (!leaseId) return null;
  const { data: lease, error: leaseError } = await admin.from("content_automation_runs")
    .select("started_at").eq("id", leaseId).single();
  if (leaseError || !lease) throw new Error(leaseError?.message || "포트폴리오 예약 잠금을 확인할 수 없습니다.");
  try {
    return await reserve();
  } finally {
    // The start timestamp is the lease owner token. Never release a newer owner.
    const { error: releaseError } = await admin.from("content_automation_runs").update({
      status: "skipped", completed_at: new Date().toISOString(),
      metrics: { purpose: RESERVATION_SCOPE }, updated_at: new Date().toISOString(),
    }).eq("id", leaseId).eq("status", "running").eq("started_at", lease.started_at);
    if (releaseError) throw new Error(releaseError.message);
  }
}

type PrepareOptions = {
  scheduleKey?: string;
  scheduledAt?: string;
  deadlineAt?: number;
  candidateId?: string;
};

export async function prepareNextPortfolioCandidate(options: PrepareOptions = {}): Promise<PortfolioPrepareResult> {
  const admin = contentAdmin();
  const failure = (reason: string): PortfolioPrepareResult => ({ prepared: false, inspected: 0, eligible: 0, reason });
  if (options.candidateId) {
    const { data: requested, error } = await admin.from("portfolio_candidates")
      .select("status,metadata,missing_fonts,exclusion_reasons").eq("id", options.candidateId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!requested) return failure("지정한 후보를 찾을 수 없습니다.");
    if (requested.status !== "candidate") return failure("대기 상태인 후보만 지정 제작할 수 있습니다. 제외되었거나 이미 사용 중인 후보입니다.");
    const excludedFont = portfolioFontExclusion(requested);
    if (excludedFont) return failure(excludedFont);
  }
  const activeReason = await activePortfolioReason();
  if (activeReason) return failure(activeReason);
  const { data: control, error: controlError } = await admin.from("portfolio_automation_control").select("*").eq("id", true).single();
  if (controlError) throw new Error(controlError.message);
  if (!control.first_run_approved) return failure("기존 보류 정리와 후보 미리보기 확인 후 첫 제작 승인이 필요합니다.");
  const inventory = await readPortfolioDedupeInventory(control.hash_threshold, {
    deadlineAt: options.deadlineAt, candidateId: options.candidateId,
  });
  const decision = selectPortfolioCandidate(options.candidateId
    ? inventory.accepted.filter(candidate => candidate.id === options.candidateId)
    : inventory.accepted);
  const inspectedFailure = (reason: string): Extract<PortfolioPrepareResult, { prepared: false }> => ({
    prepared: false, inspected: inventory.metrics.inspected, eligible: decision.eligible,
    reason, inspection: inventory.metrics,
  });
  for (const check of inventory.decisions) {
    if (check.candidate.id === decision.selected?.candidate.id
      || (options.candidateId && check.candidate.id !== options.candidateId)) continue;
    const row = check.candidate as CandidateRow & { updated_at: string };
    const inspectionState = row.metadata?.inspectionState;
    // Successful source inspections are already persisted by the inventory.
    // Rewriting another selectable candidate here can invalidate a concurrent
    // designated reservation even though its evidence has not changed.
    if (inspectionState === "passed" && !check.match && !check.fontExclusionReason) continue;
    const imageReviewReason = inspectionState === "no_preview"
      ? "검사 완료 · 파일 안에 미리보기 이미지가 없어 중복 확인 불가"
      : inspectionState === "too_large" ? "100MB 초과 · 자동 검사 대상 아님"
        : inspectionState === "failed" ? row.exclusion_reasons?.[0] || "원본 확인 필요"
          : null;
    const { error } = await admin.from("portfolio_candidates").update({
      duplicate_score: check.duplicateScore,
      updated_at: new Date().toISOString(),
      ...(check.match || check.fontExclusionReason ? { status: "excluded", exclusion_reasons: [check.reason] } : {}),
      metadata: { ...row.metadata, normalizedProjectName: check.normalizedName,
        fontExclusionReason: check.fontExclusionReason,
        fontReviewReason: inspectionState !== "pending" && inventory.needsFontReview.some(candidate => candidate.id === row.id)
          ? "검수 필요: 변환 전 원본 글꼴 확인 필요" : null,
        imageReviewReason,
        ...(check.match ? { duplicateMatch: check.match } : {}) },
    }).eq("id", row.id).eq("status", "candidate").eq("updated_at", row.updated_at);
    if (error) throw new Error(error.message);
  }
  const { selected, shortlist } = decision;
  if (!selected) {
    const targetCheck = options.candidateId
      ? inventory.decisions.find(check => check.candidate.id === options.candidateId) : undefined;
    if (targetCheck?.match) return {
      ...inspectedFailure(targetCheck.reason || "이미 발행했거나 제작 중인 프로젝트와 중복됩니다."),
      prepared: false,
      duplicateMatch: { title: targetCheck.match.title, url: targetCheck.match.url },
    };
    if (targetCheck?.fontExclusionReason) return inspectedFailure(targetCheck.fontExclusionReason);
    if (inventory.metrics.remaining && !options.candidateId) return {
      ...inspectedFailure(`후보 검사 진행 중: ${inventory.metrics.inspected}/${inventory.metrics.total} 완료, 합격 0. 다음 호출에서 이어서 합니다.`),
      prepared: false, inspectionPending: true,
    };
    if (inventory.sourceFailures.length && !inventory.decisions.length) return inspectedFailure(
      `원본 확인 실패: 후보 ${inventory.sourceFailures.length}건을 모두 제외했습니다.`,
    );
    if (options.candidateId) {
      const state = targetCheck?.candidate.metadata?.inspectionState;
      return inspectedFailure(state === "too_large" ? "100MB 초과 파일은 자동 검사 대상이 아니므로 제작할 수 없습니다."
        : state === "no_preview" ? "파일 안에 미리보기 이미지가 없어 중복 확인이 불가능합니다. 지문 없는 후보는 이번 지정 제작에서 허용하지 않습니다."
          : inventory.sourceFailures.find(item => item.candidateId === options.candidateId)?.reason
            || "원본 글꼴과 대표 이미지 지문 검사가 완료되어야 지정 제작할 수 있습니다.");
    }
    return inspectedFailure(inventory.metrics.total
      ? `후보 검사 완료: ${inventory.metrics.inspected}/${inventory.metrics.total} 완료, 합격 0. 미리보기 이미지·글꼴·중복 제외 사유를 확인해 주세요.`
      : decision.reason!);
  }

  const candidate = selected.candidate;
  const file = driveFile(candidate);
  if (!file) return inspectedFailure("고른 후보에 연결된 드라이브 파일 정보가 없습니다.");
  const scheduleKey = options.scheduleKey || `naver-works-portfolio-${candidate.id}`;
  const inspected = inventory.decisions.find(check => check.candidate.id === candidate.id)!;
  const workPayload = {
    channel: "naver_design", format: "portfolio", title: candidate.project_name,
    summary: "NAVER WORKS에서 1차 선별한 디자인 프로젝트입니다. 실제 페이지 판정, 민감정보 처리, 목업 합성, 본문 작성을 순서대로 진행합니다.",
    status: "researching", source_label: "NAVER WORKS 공용 폴더",
    source_reference: file.file_path || file.file_name,
    scheduled_at: options.scheduledAt || null, schedule_key: scheduleKey,
    created_by: "automation@woolimcompany.kr",
    metadata: {
      candidateId: candidate.id, driveFileId: file.id, sourceFileName: file.file_name, sourcePath: file.file_path,
      pipeline: ["download", "convert", "font_check", "privacy_check", "mockup", "draft"],
      selectionScore: selected.score, selectionReasons: selected.reasons,
      shortlist: shortlist.map(item => ({ candidateId: item.id, confidence: item.confidence, reasons: item.reasons })),
      automated: true, sourceInspectionMetrics: inventory.metrics,
    },
    updated_at: new Date().toISOString(),
  };
  const reserved = await withReservationLease(async (): Promise<PortfolioPrepareResult> => {
    const latestActiveReason = await activePortfolioReason();
    if (latestActiveReason) return inspectedFailure(latestActiveReason);
    const { data: existingItem, error: existingItemError } = await admin.from("content_work_items").select("id").eq("schedule_key", scheduleKey).maybeSingle();
    if (existingItemError) throw new Error(existingItemError.message);
    if (existingItem) return inspectedFailure("이 일정에 이미 작업이 있어 보존했습니다.");
    const { data: workItemId, error: reservationError } = await admin.rpc("reserve_deduplicated_portfolio_candidate", {
      p_id: candidate.id, p_updated_at: (candidate as CandidateRow & { updated_at: string }).updated_at,
      p_normalized_name: inspected.normalizedName,
      p_metadata: { ...candidate.metadata, normalizedProjectName: inspected.normalizedName,
        dedupeVersion: PORTFOLIO_DEDUPE_VERSION, selectionScore: selected.score, shortlist,
        duplicateScore: inspected.duplicateScore, selectionReasons: selected.reasons },
      p_work_item: workPayload,
    });
    if (reservationError) throw new Error(reservationError.message);
    if (!workItemId) return inspectedFailure("다른 실행에서 같은 프로젝트 또는 일정을 먼저 선택했습니다.");
    return {
      prepared: true, inspected: inventory.metrics.inspected, eligible: decision.eligible,
      candidateId: candidate.id, workItemId, projectName: candidate.project_name,
      score: selected.score, shortlistCount: shortlist.length, inspection: inventory.metrics,
    };
  });
  return reserved || inspectedFailure("다른 실행에서 포트폴리오 후보를 예약하고 있습니다. 잠시 후 다시 시도해 주세요.");
}
