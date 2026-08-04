import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sanitizeGeneratedHtml } from "@/lib/security/html";

export const dynamic = "force-dynamic";

async function authenticatedAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email) ? user : null;
}

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("column_posts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.title || !body.slug || !body.content) {
    return NextResponse.json({ error: "제목, 슬러그, 본문은 필수입니다." }, { status: 400 });
  }

  const published = Boolean(body.published);
  const { data, error } = await createAdminClient()
    .from("column_posts")
    .insert({
      title: body.title,
      slug: body.slug,
      excerpt: body.excerpt || null,
      content: sanitizeGeneratedHtml(body.content),
      tags: Array.isArray(body.tags) ? body.tags : [],
      category: body.category || null,
      content_kind: body.content_kind || "informational",
      audience: body.audience || null,
      core_message: body.core_message || null,
      published,
      published_at: published ? new Date().toISOString() : null,
      generation_status: body.generation_status || "draft",
      generation_metadata: body.generation_metadata || {},
      author_email: user.email,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
