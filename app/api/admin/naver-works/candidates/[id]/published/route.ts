import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { normalizeNaverBlogUrl } from "@/lib/publication";
import { normalizePortfolioProjectName } from "@/lib/portfolio/project-name";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authenticatedAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  const publication = normalizeNaverBlogUrl(body.url);
  if (!publication || publication.account !== "wl_0109" || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "wl_0109의 게시물 URL과 제목을 입력해 주세요." }, { status: 400 });
  }
  const admin = contentAdmin();
  const { data, error } = await admin.from("portfolio_candidates").select("project_name,updated_at").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const { error: saveError } = await admin.rpc("exclude_published_portfolio_candidate", {
    p_candidate_id: id, p_updated_at: data.updated_at,
    p_project_name: normalizePortfolioProjectName(data.project_name),
    p_url: publication.normalizedUrl, p_title: body.title.trim(), p_published_at: null,
  });
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 409 });
  return NextResponse.json({ success: true });
}
