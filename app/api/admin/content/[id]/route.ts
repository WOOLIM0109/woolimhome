import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import type { WorkflowStatus } from "@/lib/content-ops/types";

const STATUSES: WorkflowStatus[] = [
  "topic_candidate", "researching", "creating", "review_required", "approved",
  "naver_ready", "scheduled", "published", "on_hold",
];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.review_note === "string") patch.review_note = body.review_note;
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at || null;
  if (body.status === "published") patch.published_at = body.published_at || new Date().toISOString();

  const { data, error } = await contentAdmin()
    .from("content_work_items").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
