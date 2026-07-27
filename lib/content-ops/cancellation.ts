import { contentAdmin } from "@/lib/content-ops/data";

const CANCELLATION_PREFIX = "generation-cancelled:";

export function cancellationMarker(requestId: string) {
  return `${CANCELLATION_PREFIX}${requestId}`;
}

export function isCancellationMarker(value: unknown) {
  return typeof value === "string" && value.startsWith(CANCELLATION_PREFIX);
}

export async function generationCancellationRequested(scheduleKey: string) {
  const { data, error } = await contentAdmin()
    .from("content_work_items")
    .select("review_note")
    .eq("schedule_key", scheduleKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return isCancellationMarker(data?.review_note);
}

export async function removeCancelledGeneration(scheduleKey: string) {
  const admin = contentAdmin();
  const { data, error } = await admin
    .from("content_work_items")
    .select("id, review_note")
    .eq("schedule_key", scheduleKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !isCancellationMarker(data.review_note)) return false;

  const { data: jobs, error: jobsError } = await admin
    .from("content_jobs")
    .select("candidate_id")
    .eq("work_item_id", data.id);
  if (jobsError) throw new Error(jobsError.message);
  const candidateIds = [...new Set(
    (jobs || []).map((job) => job.candidate_id).filter((value): value is string => Boolean(value)),
  )];
  if (candidateIds.length) {
    const { data: candidates, error: candidatesError } = await admin
      .from("portfolio_candidates")
      .select("id, metadata")
      .in("id", candidateIds);
    if (candidatesError) throw new Error(candidatesError.message);
    for (const candidate of candidates || []) {
      const metadata = candidate.metadata && typeof candidate.metadata === "object"
        ? { ...candidate.metadata }
        : {};
      delete metadata.workItemId;
      delete metadata.selectedAt;
      const { error: candidateError } = await admin
        .from("portfolio_candidates")
        .update({ status: "candidate", metadata, updated_at: new Date().toISOString() })
        .eq("id", candidate.id);
      if (candidateError) throw new Error(candidateError.message);
    }
  }

  await admin.from("content_jobs").delete().eq("work_item_id", data.id);
  const { error: deleteError } = await admin
    .from("content_work_items")
    .delete()
    .eq("id", data.id);
  if (deleteError) throw new Error(deleteError.message);
  return true;
}
