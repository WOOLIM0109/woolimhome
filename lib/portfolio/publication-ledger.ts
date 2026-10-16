import { contentAdmin } from "@/lib/content-ops/data";
import { normalizePortfolioProjectName } from "./project-name";

/** Carried into the publication UPDATE; the DB trigger commits the ledger atomically. */
export async function portfolioPublicationEvidence(workItemId: string) {
  const admin = contentAdmin();
  const { data: item, error } = await admin.from("content_work_items")
    .select("format,channel,title,metadata").eq("id", workItemId).single();
  if (error) throw new Error(error.message);
  if (item.channel !== "naver_design" || item.format !== "portfolio") return null;
  const metadata = item.metadata || {};
  const candidateId = metadata.candidateId;
  const { data: candidate, error: candidateError } = candidateId
    ? await admin.from("portfolio_candidates").select("project_name,drive_file_id,metadata").eq("id", candidateId).single()
    : { data: null, error: null };
  if (candidateError) throw new Error(candidateError.message);
  const normalized = normalizePortfolioProjectName(candidate?.project_name || metadata.sourceFileName || item.title);
  if (!normalized) throw new Error("발행 원장에 기록할 프로젝트명이 비어 있습니다.");
  return { normalizedProjectName: normalized, candidateId: candidateId || null,
    driveFileId: candidate?.drive_file_id || metadata.driveFileId || null,
    representativeHashes: candidate?.metadata?.representativeHashes || [] };
}
