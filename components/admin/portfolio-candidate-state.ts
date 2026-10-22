type CandidateState = {
  fileSize?: number;
  fontExclusionReason?: string | null;
  metadata?: {
    inspectionState?: string;
    imageReviewReason?: string;
    sourceInspectionFailure?: { reason?: string };
  };
};

export function candidateInspectionLabel(candidate: CandidateState) {
  switch (candidate.metadata?.inspectionState) {
    case "passed": return "";
    case "no_preview": return "검사 완료 · 파일 안에 미리보기 이미지가 없어 중복 확인 불가";
    case "too_large": return "100MB 초과 · 자동 검사 대상 아님";
    case "failed": return candidate.metadata.sourceInspectionFailure?.reason || candidate.metadata.imageReviewReason || "원본 확인 필요: 검사 실패";
    default: return "검사 전";
  }
}

export function candidateProductionBlockReason(candidate: CandidateState, context: {
  connected: boolean;
  activePortfolioCount: number;
  preparing: boolean;
}) {
  if (!context.connected) return "NAVER WORKS 연결이 필요합니다.";
  if (context.preparing || context.activePortfolioCount > 0) return "진행 중인 포트폴리오 작업이 있습니다.";
  if ((candidate.fileSize || 0) > 100 * 1024 * 1024 || candidate.metadata?.inspectionState === "too_large") return "100MB 초과 파일은 이번 지정 제작 대상이 아닙니다.";
  if (candidate.fontExclusionReason) return candidate.fontExclusionReason;
  if (candidate.metadata?.inspectionState === "no_preview") return "미리보기 이미지가 없어 중복 확인을 통과할 수 없습니다.";
  if (candidate.metadata?.inspectionState === "failed") return candidateInspectionLabel(candidate);
  return "";
}
