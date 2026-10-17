import { contentAdmin } from "@/lib/content-ops/data";
import { inspectPortfolioDuplicates, validProjectHashes, type ProjectReference } from "./project-dedupe";
import { normalizePortfolioProjectName } from "./project-name";
import type { CandidateRow } from "../naver-works/portfolio-selection";
import { fingerprintPortfolioImage } from "./image-fingerprint";
import JSZip from "jszip";
import { driveFile } from "../naver-works/portfolio-selection";
import { downloadSharedDriveFile } from "../naver-works/client";
import { PORTFOLIO_FONT_POLICY_VERSION, portfolioFontExclusion } from "./font-policy";
import { readPptxSourceFonts } from "./source-fonts";

export async function readAllPortfolioRows(table: string, columns = "*") {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await contentAdmin().from(table).select(columns).order("id").range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...data as unknown as Record<string, unknown>[]);
    if (data.length < 500) return rows;
  }
}
/** Never queues conversion or AI. Only preview GET must also forbid OAuth refresh writes. */
export async function readPortfolioDedupeInventory(threshold: number, options: { readOnly?: boolean } = {}) {
  const [rows, ledger, sets, jobs, items] = await Promise.all([
    readAllPortfolioRows("portfolio_candidates", "*,naver_works_drive_files!inner(id,file_name,file_path,file_extension,file_size,root_id,modified_at)"),
    readAllPortfolioRows("portfolio_publication_ledger"), readAllPortfolioRows("portfolio_image_sets"),
    readAllPortfolioRows("content_jobs", "id,candidate_id,job_type,status,result,updated_at"),
    readAllPortfolioRows("content_work_items", "id,title,channel,format,status,metadata,published_url_normalized"),
  ]);
  const candidates = rows as unknown as CandidateRow[];
  const hashCache = new Map<string, string>();
  async function storedHash(bucket: string, path: string) {
    const key = `${bucket}/${path}`;
    if (hashCache.has(key)) return hashCache.get(key)!;
    if (bucket !== "portfolio-rendered" || !path || path.includes("..")) throw new Error("중복 검수 이미지 경로가 올바르지 않습니다.");
    const { data, error } = await contentAdmin().storage.from(bucket).download(path);
    if (error) throw new Error(`중복 검수 이미지 조회 실패: ${error.message}`);
    const hash = (await fingerprintPortfolioImage(Buffer.from(await data.arrayBuffer()))).visualHash;
    hashCache.set(key, hash); return hash;
  }
  for (const candidate of candidates) {
    if (portfolioFontExclusion(candidate)) continue;
    const file = driveFile(candidate);
    const cached = candidate.status !== "candidate" || Boolean(file?.modified_at && candidate.metadata?.hashSourceModifiedAt === file.modified_at);
    const hashes = cached ? validProjectHashes(candidate.metadata?.representativeHashes) : [];
    const conversion = jobs.filter(job => job.candidate_id === candidate.id && job.job_type === "convert" && job.status === "completed")
      .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    const result = conversion?.result as { bucket?: string; slidePaths?: string[] } | undefined;
    if (result?.bucket && result.slidePaths?.length && (candidate.status !== "candidate"
      || (file?.modified_at && Date.parse(String(conversion.updated_at)) >= Date.parse(file.modified_at)))) {
      for (const path of result.slidePaths.slice(0, 3)) hashes.push(await storedHash(result.bucket, path));
    }
    const fontsVerified = candidate.metadata?.fontPolicyVersion === PORTFOLIO_FONT_POLICY_VERSION
      && Boolean(file?.modified_at && candidate.metadata?.fontSourceModifiedAt === file.modified_at);
    if (candidate.status === "candidate" && (!hashes.length || !fontsVerified)) {
      if (!fontsVerified) candidate.metadata = { ...candidate.metadata, fontPolicyVersion: null };
      if (file && /\.pptx$/i.test(file.file_name) && file.file_size <= 100 * 1024 * 1024) {
        const { data: source, error } = await contentAdmin().from("naver_works_drive_files")
          .select("external_file_id,naver_works_drive_roots!inner(external_drive_id)").eq("id", file.id).single();
        if (error) throw new Error(error.message);
        const roots = source.naver_works_drive_roots as unknown as { external_drive_id: string } | { external_drive_id: string }[];
        const root = Array.isArray(roots) ? roots[0] : roots;
        const response = await downloadSharedDriveFile(root.external_drive_id, source.external_file_id, options);
        const zip = await JSZip.loadAsync(await response.arrayBuffer());
        try {
          const sourceFonts = await readPptxSourceFonts(zip);
          candidate.metadata = { ...candidate.metadata, sourceFonts, fontPolicyVersion: PORTFOLIO_FONT_POLICY_VERSION,
            fontSourceModifiedAt: file.modified_at, fontReviewReason: null };
        } catch {
          candidate.metadata = { ...candidate.metadata, fontPolicyVersion: null, fontReviewReason: "검수 필요: 원본 글꼴을 확인하지 못했습니다." };
        }
        const thumbnail = Object.values(zip.files).find(entry => /^docProps\/thumbnail\.(png|jpe?g)$/i.test(entry.name));
        if (thumbnail) hashes.push((await fingerprintPortfolioImage(await thumbnail.async("nodebuffer"))).visualHash);
      }
    }
    candidate.metadata = { ...candidate.metadata, representativeHashes: [...new Set(validProjectHashes(hashes))], hashSourceModifiedAt: file?.modified_at || null };
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
  const inspection = inspectPortfolioDuplicates(candidates, references, threshold);
  // Unknown visual evidence is a review task, never permission to convert first.
  const needsImageReview = inspection.accepted.filter(row => !validProjectHashes(row.metadata?.representativeHashes).length);
  const needsFontReview = inspection.accepted.filter(row => row.metadata?.fontPolicyVersion !== PORTFOLIO_FONT_POLICY_VERSION);
  return { ...inspection, needsImageReview, needsFontReview, accepted: inspection.accepted.filter(row =>
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
