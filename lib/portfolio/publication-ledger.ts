import { contentAdmin } from "@/lib/content-ops/data";
import { normalizePortfolioProjectName } from "./project-name";
import { fingerprintPortfolioImage } from "./image-fingerprint";
import { validProjectHashes } from "./project-dedupe";

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
  const hashes = validProjectHashes(candidate?.metadata?.representativeHashes);
  if (candidateId) {
    const { data: conversion, error: conversionError } = await admin.from("content_jobs").select("result")
      .eq("candidate_id", candidateId).eq("job_type", "convert").eq("status", "completed")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (conversionError) throw new Error(conversionError.message);
    const result = conversion?.result as { bucket?: string; slidePaths?: string[] } | undefined;
    for (const path of (result?.slidePaths || []).slice(0, 3)) {
      if (result?.bucket !== "portfolio-rendered" || path.includes("..")) throw new Error("발행 원장 대표 이미지 경로가 올바르지 않습니다.");
      const { data: image, error: imageError } = await admin.storage.from(result.bucket).download(path);
      if (imageError) throw new Error(imageError.message);
      hashes.push((await fingerprintPortfolioImage(Buffer.from(await image.arrayBuffer()))).visualHash);
    }
  }
  return { normalizedProjectName: normalized, candidateId: candidateId || null,
    driveFileId: candidate?.drive_file_id || metadata.driveFileId || null,
    representativeHashes: [...new Set(validProjectHashes(hashes))] };
}
