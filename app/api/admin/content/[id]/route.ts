import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { validatePortfolioBodyHtml } from "@/lib/content-ops/portfolio-rules";
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
  if (body.status === "approved") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("format,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.format === "portfolio") {
      const generated = current.metadata?.generated as { bodyHtml?: string } | undefined;
      const issues = validatePortfolioBodyHtml(generated?.bodyHtml || "");
      if (issues.length) {
        return NextResponse.json(
          { error: `포트폴리오 기본 규칙을 확인해 주세요: ${issues.join(" ")}` },
          { status: 400 },
        );
      }
    }
  }
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
