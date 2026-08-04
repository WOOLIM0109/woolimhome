import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ColumnPost } from "@/lib/columns/types";
import { sanitizeGeneratedHtml } from "@/lib/security/html";

type Params = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

async function authenticatedAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email) ? user : null;
}

export async function GET(_request: Request, { params }: Params) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await createAdminClient()
    .from("column_posts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

export async function PUT(request: Request, { params }: Params) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const admin = createAdminClient();
  const { data: existingData, error: existingError } = await admin
    .from("column_posts")
    .select("*")
    .eq("id", id)
    .single();
  if (existingError) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = existingData as ColumnPost;
  const body = await request.json();
  const published = Boolean(body.published);
  const update = {
    title: body.title,
    slug: body.slug,
    excerpt: body.excerpt || null,
    content: sanitizeGeneratedHtml(body.content || ""),
    tags: Array.isArray(body.tags) ? body.tags : [],
    category: body.category || null,
    content_kind: body.content_kind || existing.content_kind,
    audience: body.audience || null,
    core_message: body.core_message || null,
    published,
    published_at: published ? existing.published_at || new Date().toISOString() : existing.published_at,
    generation_status: existing.generation_status === "generated" ? "reviewed" : existing.generation_status,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from("column_posts")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing.generation_status !== "draft") {
    await admin.from("column_editorial_feedback").insert({
      post_id: id,
      generation_run_id: typeof existing.generation_metadata?.run_id === "string"
        ? existing.generation_metadata.run_id
        : null,
      reviewer_email: user.email!,
      decision: !existing.published && published ? "approved" : "edited",
      before_payload: existing,
      after_payload: data,
    });
  }
  revalidatePath("/columns");
  revalidatePath(`/columns/${existing.slug}`);
  revalidatePath(`/columns/${data.slug}`);
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { error } = await createAdminClient().from("column_posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidatePath("/columns");
  return NextResponse.json({ success: true });
}
