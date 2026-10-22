import type { CandidateDriveFile, CandidateRow } from "../naver-works/portfolio-selection.ts";
import { PORTFOLIO_FONT_POLICY_VERSION } from "./font-policy.ts";
import { validProjectHashes } from "./project-dedupe.ts";

export const SOURCE_INSPECTION_VERSION = "source-inspection-v1";
export const PORTFOLIO_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
export type SourceInspectionState = "pending" | "no_preview" | "too_large" | "failed" | "passed";
export type SourceInspection = {
  version: string; driveFileId: string; modifiedAt: string; fileSize: number;
  fontPolicyVersion: string; sourceFonts: string[]; representativeHashes: string[]; inspectedAt: string;
};
export type SourceInspectionFailure = {
  candidateId: string; driveFileId: string; fileName: string;
  modifiedAt?: string | null; fileSize?: number;
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

/** A missing or stale cache is not evidence that a file has no preview. */
export function sourceInspectionState(candidate: CandidateRow): SourceInspectionState {
  const file = Array.isArray(candidate.naver_works_drive_files) ? candidate.naver_works_drive_files[0] : candidate.naver_works_drive_files;
  const failure = candidate.metadata?.sourceInspectionFailure as Partial<SourceInspectionFailure> | undefined;
  if (failure && (candidate.status === "excluded" || (file && failure.driveFileId === file.id
    && failure.modifiedAt === file.modified_at && failure.fileSize === file.file_size))) return "failed";
  if (file && file.file_size > PORTFOLIO_SOURCE_MAX_BYTES) return "too_large";
  const cache = file && cachedSourceInspection(candidate.metadata?.sourceInspection, file);
  if (cache) return validProjectHashes(cache.representativeHashes).length ? "passed" : "no_preview";
  return "pending";
}

export function sourceInspectionFailure(candidateId: string, file: CandidateDriveFile, httpStatus: number | null,
  stage: SourceInspectionFailure["stage"]): SourceInspectionFailure {
  return { candidateId, driveFileId: file.id, fileName: file.file_name, modifiedAt: file.modified_at, fileSize: file.file_size, httpStatus, stage,
    reason: `원본 확인 필요: ${httpStatus ? `HTTP ${httpStatus}` : stage === "parse" ? "원본 해석 실패" : "다운로드 연결 오류"}`,
    inspectedAt: new Date().toISOString() };
}
