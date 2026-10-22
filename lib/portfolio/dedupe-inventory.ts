import { contentAdmin } from "@/lib/content-ops/data";
import { inspectPortfolioDuplicates, validProjectHashes, type ProjectReference } from "./project-dedupe";
import { normalizePortfolioProjectName } from "./project-name";
import type { CandidateRow } from "../naver-works/portfolio-selection";
import { fingerprintPortfolioImage } from "./image-fingerprint";
import JSZip from "jszip";
import { driveFile, projectScore, explorationScore } from "../naver-works/portfolio-selection";
import { accessToken, downloadSharedDriveFile, DriveFileDownloadError } from "../naver-works/client";
import { PORTFOLIO_FONT_POLICY_VERSION, portfolioFontExclusion } from "./font-policy";
import { readPptxSourceFonts } from "./source-fonts";
import { cachedSourceInspection, sourceInspectionFailure, sourceInspectionState, PORTFOLIO_SOURCE_MAX_BYTES, SOURCE_INSPECTION_VERSION, type SourceInspectionFailure } from "./source-inspection";

export const PORTFOLIO_INSPECTION_TARGET_ACCEPTED = 8;
export type PortfolioInspectionMetrics = {
  total: number; inspected: number; remaining: number; deadlineReached: boolean;
  downloaded: number; cached: number; failed: number; skippedLarge: number;
  durationMs: number; peakRssMb: number;
  tableReadMs: number; imageHashMs: number; candidateDownloadMs: number;
};
export type PortfolioInspectionOptions = { readOnly?: boolean; deadlineAt?: number; candidateId?: string };

export async function readAllPortfolioRows(table: string, columns = "*") {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await contentAdmin().from(table).select(columns).order("id").range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...data as unknown as Record<string, unknown>[]);
    if (data.length < 500) return rows;
  }
}
/** Source inspection only: preview never downloads sources, refreshes OAuth, or writes. */
export async function readPortfolioDedupeInventory(threshold: number, options: PortfolioInspectionOptions = {}) {
  const startedAt = Date.now();
  const sourceFailures: SourceInspectionFailure[] = [];
  const metrics: PortfolioInspectionMetrics = { total: 0, inspected: 0, remaining: 0, deadlineReached: false,
    downloaded: 0, cached: 0, failed: 0, skippedLarge: 0, durationMs: 0, peakRssMb: 0,
    tableReadMs: 0, imageHashMs: 0, candidateDownloadMs: 0 };
  const sampleMemory = () => {
    if (typeof process !== "undefined" && typeof process.memoryUsage === "function") metrics.peakRssMb = Math.max(metrics.peakRssMb, process.memoryUsage().rss / 1024 / 1024);
  };
  sampleMemory();
  const [rows, ledger, sets, jobs, items] = await Promise.all([
    readAllPortfolioRows("portfolio_candidates", "*,naver_works_drive_files!inner(id,file_name,file_path,file_extension,file_size,root_id,modified_at)"),
    readAllPortfolioRows("portfolio_publication_ledger"), readAllPortfolioRows("portfolio_image_sets"),
    readAllPortfolioRows("content_jobs", "id,candidate_id,job_type,status,result,updated_at"),
    readAllPortfolioRows("content_work_items", "id,title,channel,format,status,metadata,published_url_normalized"),
  ]);
  metrics.tableReadMs = Date.now() - startedAt;
  sampleMemory();
  const candidates = rows as unknown as CandidateRow[];
  const pendingCandidates = candidates.filter(candidate => candidate.status === "candidate");
  metrics.total = pendingCandidates.length;
  const hashCache = new Map<string, string>();
  async function storedHash(bucket: string, path: string) {
    const key = `${bucket}/${path}`;
    if (hashCache.has(key)) return hashCache.get(key)!;
    if (bucket !== "portfolio-rendered" || !path || path.includes("..")) throw new Error("중복 검수 이미지 경로가 올바르지 않습니다.");
    const started = Date.now();
    try {
      const { data, error } = await contentAdmin().storage.from(bucket).download(path);
      if (error) throw new Error(`중복 검수 이미지 조회 실패: ${error.message}`);
      const hash = (await fingerprintPortfolioImage(Buffer.from(await data.arrayBuffer()))).visualHash;
      sampleMemory(); hashCache.set(key, hash); return hash;
    } finally { metrics.imageHashMs += Date.now() - started; }
  }
  async function persistInspection(candidate: CandidateRow, failed = false) {
    if (options.readOnly) return;
    const current = candidate as CandidateRow & { updated_at: string };
    const updatedAt = new Date().toISOString();
    const { data, error } = await contentAdmin().from("portfolio_candidates").update({
      metadata: candidate.metadata, updated_at: updatedAt,
      ...(failed ? { status: "excluded", exclusion_reasons: candidate.exclusion_reasons } : {}),
    }).eq("id", candidate.id).eq("status", "candidate").eq("updated_at", current.updated_at).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("원본 검사 중 후보가 변경되었습니다. 동시 실행 결과를 확인해 주세요.");
    current.updated_at = updatedAt;
  }
  async function conversionHashes(candidate: CandidateRow, hashes: string[]) {
    const file = driveFile(candidate);
    const conversion = jobs.filter(job => job.candidate_id === candidate.id && job.job_type === "convert" && job.status === "completed")
      .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    const result = conversion?.result as { bucket?: string; slidePaths?: string[] } | undefined;
    if (result?.bucket && result.slidePaths?.length && (candidate.status !== "candidate"
      || (file?.modified_at && candidate.metadata?.hashSourceFileSize === file.file_size
        && Date.parse(String(conversion.updated_at)) >= Date.parse(file.modified_at)))) {
      for (const path of result.slidePaths.slice(0, 3)) hashes.push(await storedHash(result.bucket, path));
    }
    return hashes;
  }
  // Hydrate every saved result before applying the deadline or target. The next call
  // must see all completed evidence even when it has no time for new downloads.
  for (const candidate of candidates) {
    const file = driveFile(candidate);
    if (candidate.status !== "candidate") {
      if (!portfolioFontExclusion(candidate)) candidate.metadata = { ...candidate.metadata,
        representativeHashes: [...new Set(await conversionHashes(candidate, validProjectHashes(candidate.metadata?.representativeHashes)))],
        hashSourceModifiedAt: file?.modified_at || null };
      continue;
    }
    const sourceCache = !portfolioFontExclusion(candidate) && file && cachedSourceInspection(candidate.metadata?.sourceInspection, file);
    if (sourceCache) {
      metrics.cached++;
      candidate.metadata = { ...candidate.metadata, sourceFonts: sourceCache.sourceFonts,
        representativeHashes: sourceCache.representativeHashes, fontPolicyVersion: sourceCache.fontPolicyVersion,
        fontSourceModifiedAt: sourceCache.modifiedAt, hashSourceModifiedAt: sourceCache.modifiedAt,
        sourceInspectionFailure: null, fontReviewReason: null,
        imageReviewReason: validProjectHashes(sourceCache.representativeHashes).length ? null
          : "검사 완료 · 파일 안에 미리보기 이미지가 없어 중복 확인 불가" };
    } else if (!portfolioFontExclusion(candidate)) {
      // Stale evidence cannot authorize selection or make a pending file look inspected.
      candidate.metadata = { ...candidate.metadata, representativeHashes: [], fontPolicyVersion: null };
    }
    candidate.metadata = { ...candidate.metadata, inspectionState: sourceInspectionState(candidate) };
    if (candidate.metadata.inspectionState === "too_large") metrics.skippedLarge++;
  }
  async function inspectCandidate(candidate: CandidateRow) {
    const file = driveFile(candidate);
    const hashes = await conversionHashes(candidate, []);
    if (file && /\.pptx$/i.test(file.file_name) && file.file_size <= PORTFOLIO_SOURCE_MAX_BYTES) {
        const { data: source, error } = await contentAdmin().from("naver_works_drive_files")
          .select("external_file_id,naver_works_drive_roots!inner(external_drive_id)").eq("id", file.id).single();
        if (error) throw new Error(error.message);
        const roots = source.naver_works_drive_roots as unknown as { external_drive_id: string } | { external_drive_id: string }[];
        const root = Array.isArray(roots) ? roots[0] : roots;
        let response: Response;
        let failure: SourceInspectionFailure | undefined;
        const downloadStartedAt = Date.now();
        try {
          metrics.downloaded++;
          response = await downloadSharedDriveFile(root.external_drive_id, source.external_file_id);
        } catch (error) {
          // OAuth / DB failures remain global; they must not exclude every source file.
          if (!(error instanceof DriveFileDownloadError)) throw error;
          failure = sourceInspectionFailure(candidate.id, file, error.httpStatus, error.stage);
        }
        if (!failure) {
          try {
            const buffer = await response!.arrayBuffer();
            metrics.candidateDownloadMs += Date.now() - downloadStartedAt;
            sampleMemory();
            const zip = await JSZip.loadAsync(buffer);
            sampleMemory();
            const sourceFonts = await readPptxSourceFonts(zip);
            const thumbnail = Object.values(zip.files).find(entry => /^docProps\/thumbnail\.(png|jpe?g)$/i.test(entry.name));
            if (thumbnail) hashes.push((await fingerprintPortfolioImage(await thumbnail.async("nodebuffer"))).visualHash);
            candidate.metadata = { ...candidate.metadata, sourceFonts, fontPolicyVersion: PORTFOLIO_FONT_POLICY_VERSION,
              fontSourceModifiedAt: file.modified_at, fontReviewReason: null, sourceInspectionFailure: null,
              sourceInspection: { version: SOURCE_INSPECTION_VERSION, driveFileId: file.id, modifiedAt: file.modified_at,
                fileSize: file.file_size, fontPolicyVersion: PORTFOLIO_FONT_POLICY_VERSION, sourceFonts,
                representativeHashes: [...new Set(validProjectHashes(hashes))], inspectedAt: new Date().toISOString() } };
          } catch {
            failure = sourceInspectionFailure(candidate.id, file, null, "parse");
          }
        } else metrics.candidateDownloadMs += Date.now() - downloadStartedAt;
        if (failure) {
          sourceFailures.push(failure); metrics.failed++;
          candidate.metadata = { ...candidate.metadata, sourceInspection: null, sourceInspectionFailure: failure,
            inspectionState: "failed", representativeHashes: [], fontPolicyVersion: null };
          candidate.exclusion_reasons = [failure.reason];
          await persistInspection(candidate, true);
          candidate.status = "excluded";
          console.warn("[portfolio-source-inspection]", JSON.stringify(failure));
          return;
        }
        candidate.metadata = { ...candidate.metadata, representativeHashes: [...new Set(validProjectHashes(hashes))],
          inspectionState: validProjectHashes(hashes).length ? "passed" : "no_preview",
          hashSourceModifiedAt: file.modified_at || null, hashSourceFileSize: file.file_size };
        sampleMemory();
        await persistInspection(candidate);
    }
  }
  const references: ProjectReference[] = ledger.map(entry => ({ id: String(entry.id), title: String(entry.title),
    normalizedName: String(entry.normalized_project_name), url: String(entry.blog_url),
    candidateId: typeof entry.candidate_id === "string" ? entry.candidate_id : undefined,
    hashes: validProjectHashes(entry.representative_hashes) }));
  // Legacy publications remain comparison evidence even before an approved history import.
  for (const item of items.filter(item => item.status === "published" && item.channel === "naver_design" && item.format === "portfolio")) {
    const metadata = item.metadata as Record<string, unknown> | undefined;
    if (typeof metadata?.sourceFileName !== "string") continue;
    const candidate = candidates.find(candidate => candidate.id === metadata.candidateId);
    references.push({ id: String(item.id), title: String(item.title),
      normalizedName: normalizePortfolioProjectName(metadata.sourceFileName),
      candidateId: candidate?.id, url: String(item.published_url_normalized || "") || undefined,
      hashes: validProjectHashes(candidate?.metadata?.representativeHashes) });
  }
  for (const set of sets) {
    const item = items.find(item => item.id === set.work_item_id);
    const metadata = item?.metadata as Record<string, unknown> | undefined;
    const manifest = set.manifest as { assets?: { bucket: string; path: string }[] };
    const hashes: string[] = [];
    for (const asset of (manifest.assets || []).slice(0, 3)) hashes.push(await storedHash(asset.bucket, asset.path));
    references.push({ id: String(set.id), title: String(item?.title || "기존 이미지 세트"),
      normalizedName: normalizePortfolioProjectName(String(metadata?.sourceFileName || "")),
      candidateId: typeof metadata?.candidateId === "string" ? metadata.candidateId : undefined,
      url: typeof item?.published_url_normalized === "string" ? item.published_url_normalized : undefined, hashes });
  }
  const acceptedRows = () => inspectPortfolioDuplicates(candidates, references, threshold).accepted.filter(row =>
    validProjectHashes(row.metadata?.representativeHashes).length && row.metadata?.fontPolicyVersion === PORTFOLIO_FONT_POLICY_VERSION);
  const queue = pendingCandidates.filter(candidate => {
    const file = driveFile(candidate);
    return (!options.candidateId || options.candidateId === candidate.id) && !portfolioFontExclusion(candidate)
      && candidate.metadata?.inspectionState === "pending" && file && /\.pptx$/i.test(file.file_name)
      && file.file_size <= PORTFOLIO_SOURCE_MAX_BYTES;
  }).sort((a, b) => projectScore(b) - projectScore(a) || explorationScore(b) - explorationScore(a) || a.id.localeCompare(b.id));
  const acceptedCount = () => acceptedRows().filter(row => !options.candidateId || row.id === options.candidateId).length;
  // Reserve the remaining acceptance slots for in-flight work, keeping both the
  // download concurrency and the eight-result target bounded.
  let next = 0, inFlight = 0;
  let fatal: unknown;
  if (!options.readOnly && queue.length && acceptedCount() < PORTFOLIO_INSPECTION_TARGET_ACCEPTED
    && (options.deadlineAt === undefined || Date.now() < options.deadlineAt)) {
    await accessToken(); // Once before parallel downloads: refresh tokens rotate.
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < queue.length && !fatal) {
        if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) { metrics.deadlineReached = true; break; }
        if (acceptedCount() + inFlight >= PORTFOLIO_INSPECTION_TARGET_ACCEPTED) break;
        const candidate = queue[next++]; inFlight++;
        try { await inspectCandidate(candidate); } catch (error) { fatal = error; }
        finally { inFlight--; sampleMemory(); }
      }
    }));
  }
  if (fatal) throw fatal;
  const inspection = inspectPortfolioDuplicates(candidates, references, threshold);
  // Unknown visual evidence is a review task, never permission to convert first.
  const needsImageReview = inspection.accepted.filter(row => !validProjectHashes(row.metadata?.representativeHashes).length);
  const needsFontReview = inspection.accepted.filter(row => row.metadata?.fontPolicyVersion !== PORTFOLIO_FONT_POLICY_VERSION);
  metrics.inspected = pendingCandidates.filter(candidate => candidate.metadata?.inspectionState !== "pending").length;
  metrics.remaining = metrics.total - metrics.inspected;
  if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt && next < queue.length) metrics.deadlineReached = true;
  metrics.durationMs = Date.now() - startedAt;
  sampleMemory();
  if (!options.readOnly) console.info("[portfolio-inventory]", JSON.stringify(metrics));
  return { ...inspection, candidates, sourceFailures, metrics, inspection: metrics, needsImageReview, needsFontReview, accepted: inspection.accepted.filter(row =>
    validProjectHashes(row.metadata?.representativeHashes).length && row.metadata?.fontPolicyVersion === PORTFOLIO_FONT_POLICY_VERSION) };
}

export async function assertPortfolioDedupePassed(candidateId: string) {
  const admin = contentAdmin();
  const [{ data: candidate, error }, { data: control, error: controlError }] = await Promise.all([
    admin.from("portfolio_candidates").select("status,metadata,missing_fonts,exclusion_reasons").eq("id", candidateId).single(),
    admin.from("portfolio_automation_control").select("first_run_approved").eq("id", true).single(),
  ]);
  if (error || controlError) throw new Error(error?.message || controlError?.message);
  const fontExclusion = portfolioFontExclusion(candidate);
  if (fontExclusion) throw new Error(fontExclusion);
  if (candidate.metadata?.fontPolicyVersion !== PORTFOLIO_FONT_POLICY_VERSION) {
    throw new Error("SOURCE_FONT_INSPECTION_REQUIRED: 변환 전 원본 글꼴 확인이 필요합니다.");
  }
  if (!control.first_run_approved || candidate.status === "excluded" || candidate.metadata?.dedupeVersion !== "project-dedupe-v1") {
    throw new Error("PORTFOLIO_DEDUPE_REQUIRED: 새 중복 검수와 첫 제작 승인이 필요합니다.");
  }
}
