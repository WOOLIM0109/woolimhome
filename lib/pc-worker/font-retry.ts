import { contentAdmin } from "@/lib/content-ops/data";
import { canRetryCandidateFonts, portfolioFontExclusion } from "../portfolio/font-policy";
export { missingFontsFromMessage } from "./font-error";

export async function retryMissingFontCandidates(
  fontInventoryFingerprint: string,
  candidateId?: string,
  force = false,
) {
  const fingerprint = fontInventoryFingerprint.trim().slice(0, 128);
  if (!fingerprint) return { requeued: 0, candidateIds: [] as string[] };
  const admin = contentAdmin();
  let query = admin.from("portfolio_candidates")
    .select("id,font_retry_fingerprint,missing_fonts,exclusion_reasons,metadata")
    .eq("font_status", "missing")
    .in("status", ["excluded", "on_hold"])
    .limit(50);
  if (candidateId) query = query.eq("id", candidateId);
  const { data: candidates, error } = await query;
  if (error) throw new Error(error.message);
  for (const candidate of candidates || []) {
    const reason = portfolioFontExclusion(candidate);
    if (!reason) continue;
    const { error: exclusionError } = await admin.from("portfolio_candidates").update({
      status: "excluded", exclusion_reasons: [reason],
      metadata: { ...candidate.metadata, fontExclusionReason: reason }, updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).in("status", ["excluded", "on_hold"]);
    if (exclusionError) throw new Error(exclusionError.message);
  }
  const due = (candidates || []).filter(candidate => canRetryCandidateFonts(candidate, fingerprint, force));
  const candidateIds: string[] = [];
  for (const candidate of due) {
    const { data: jobs, error: jobsError } = await admin.from("content_jobs")
      .select("id,work_item_id")
      .eq("candidate_id", candidate.id)
      .eq("job_type", "convert")
      .in("status", ["failed", "on_hold"]);
    if (jobsError) throw new Error(jobsError.message);
    if (!jobs?.length) continue;
    const jobIds = jobs.map((job) => job.id);
    const { error: jobUpdateError } = await admin.from("content_jobs").update({
      status: "pc_waiting",
      attempts: 0,
      claimed_by_worker_id: null,
      claimed_at: null,
      lease_expires_at: null,
      error_message: null,
      last_error_code: null,
      next_retry_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }).in("id", jobIds);
    if (jobUpdateError) throw new Error(jobUpdateError.message);
    await admin.from("portfolio_candidates").update({
      status: "selected",
      font_status: "unchecked",
      font_retry_fingerprint: fingerprint,
      updated_at: new Date().toISOString(),
    }).eq("id", candidate.id);
    const workItemIds = [...new Set(jobs.map((job) => job.work_item_id).filter(Boolean))];
    if (workItemIds.length) {
      await admin.from("content_work_items").update({
        status: "researching",
        summary: "설치된 글꼴 변경을 확인해 회사 PC 변환을 자동으로 다시 요청했습니다.",
        review_note: null,
        updated_at: new Date().toISOString(),
      }).in("id", workItemIds);
    }
    candidateIds.push(candidate.id);
  }
  return { requeued: candidateIds.length, candidateIds };
}
