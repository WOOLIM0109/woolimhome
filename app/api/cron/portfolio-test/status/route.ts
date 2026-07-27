import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TEST_SCHEDULE_KEY = "portfolio-pipeline-review-20260728-v2";

export async function GET() {
  const admin = createAdminClient();
  const { data: workItem } = await admin.from("content_work_items")
    .select("id,status,metadata,updated_at")
    .eq("schedule_key", TEST_SCHEDULE_KEY)
    .maybeSingle();
  if (!workItem) {
    return NextResponse.json({ exists: false }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const [{ data: jobs }, { count: assetCount }, { data: candidates }] = await Promise.all([
    admin.from("content_jobs")
      .select("job_type,status,error_message")
      .eq("work_item_id", workItem.id)
      .order("created_at", { ascending: true }),
    admin.from("content_review_assets")
      .select("id", { count: "exact", head: true })
      .eq("work_item_id", workItem.id),
    admin.from("portfolio_candidates").select("status").limit(5000),
  ]);
  const candidateStatusCounts = (candidates || []).reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.status] = (counts[candidate.status] || 0) + 1;
    return counts;
  }, {});
  return NextResponse.json({
    exists: true,
    status: workItem.status,
    updatedAt: workItem.updated_at,
    hasDraft: Boolean(workItem.metadata?.generated?.bodyHtml),
    validation: workItem.metadata?.validation || null,
    assetCount: assetCount || 0,
    jobs: (jobs || []).map((job) => ({
      job_type: job.job_type,
      status: job.status,
      error: job.status === "failed" ? job.error_message : null,
    })),
    candidateStatusCounts,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
