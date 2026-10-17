import type { CandidateDriveFile } from "../naver-works/portfolio-selection.ts";
import { PORTFOLIO_FONT_POLICY_VERSION } from "./font-policy.ts";

export const SOURCE_INSPECTION_VERSION = "source-inspection-v1";
export type SourceInspection = {
  version: string; driveFileId: string; modifiedAt: string; fileSize: number;
  fontPolicyVersion: string; sourceFonts: string[]; representativeHashes: string[]; inspectedAt: string;
};
export type SourceInspectionFailure = {
  candidateId: string; driveFileId: string; fileName: string;
  httpStatus: number | null; stage: "download_url" | "download" | "parse";
  reason: string; inspectedAt: string;
};
export function cachedSourceInspection(value: unknown, file: CandidateDriveFile): SourceInspection | null {
  const cache = value as Partial<SourceInspection> | undefined;
  // Missing timestamps cannot prove an unchanged file. Empty hashes ARE a completed inspection.
  return cache?.version === SOURCE_INSPECTION_VERSION && Boolean(file.modified_at)
    && cache.driveFileId === file.id && cache.modifiedAt === file.modified_at && cache.fileSize === file.file_size
    && cache.fontPolicyVersion === PORTFOLIO_FONT_POLICY_VERSION
    && Array.isArray(cache.sourceFonts) && cache.sourceFonts.every(font => typeof font === "string")
    && Array.isArray(cache.representativeHashes) && cache.representativeHashes.every(hash => typeof hash === "string" && /^[a-f0-9]{16}$/i.test(hash))
    ? cache as SourceInspection : null;
}

export function sourceInspectionFailure(candidateId: string, file: CandidateDriveFile, httpStatus: number | null,
  stage: SourceInspectionFailure["stage"]): SourceInspectionFailure {
  return { candidateId, driveFileId: file.id, fileName: file.file_name, httpStatus, stage,
    reason: `원본 확인 필요: ${httpStatus ? `HTTP ${httpStatus}` : stage === "parse" ? "원본 해석 실패" : "다운로드 연결 오류"}`,
    inspectedAt: new Date().toISOString() };
}
