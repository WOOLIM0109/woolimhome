import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SOURCE_TYPES = new Set(["interview", "case", "note"]);
const EXPERTISE_AREAS = new Set([
  "planning",
  "design",
  "government_support",
  "business_plan",
  "ir_ppt",
  "management",
  "general",
]);

async function adminUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email) ? user : null;
}

export async function GET(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
  const { data, error } = await createAdminClient()
    .from("column_expert_knowledge")
    .select(summaryOnly ? "id, topic, expertise_area, approved, use_count, last_used_at, created_at" : "*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.topic || !body.raw_text) {
    return NextResponse.json({ error: "주제와 원천 내용은 필수입니다." }, { status: 400 });
  }
  const { data, error } = await createAdminClient()
    .from("column_expert_knowledge")
    .insert({
      topic: body.topic,
      source_type: body.source_type || "interview",
      expertise_area: body.expertise_area || "general",
      raw_text: body.raw_text,
      perspective: body.perspective || null,
      case_evidence: body.case_evidence || null,
      differentiator: body.differentiator || null,
      approved: Boolean(body.approved),
      created_by: user.email,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "ID가 필요합니다." }, { status: 400 });

  const changes: Record<string, string | boolean | null> = {
    updated_at: new Date().toISOString(),
  };

  if ("approved" in body) changes.approved = Boolean(body.approved);
  if ("topic" in body) {
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    if (!topic) return NextResponse.json({ error: "주제는 필수입니다." }, { status: 400 });
    changes.topic = topic;
  }
  if ("raw_text" in body) {
    const rawText = typeof body.raw_text === "string" ? body.raw_text.trim() : "";
    if (!rawText) return NextResponse.json({ error: "원천 내용은 필수입니다." }, { status: 400 });
    changes.raw_text = rawText;
  }
  if ("source_type" in body) {
    if (!SOURCE_TYPES.has(body.source_type)) return NextResponse.json({ error: "지원하지 않는 자료 종류입니다." }, { status: 400 });
    changes.source_type = body.source_type;
  }
  if ("expertise_area" in body) {
    if (!EXPERTISE_AREAS.has(body.expertise_area)) return NextResponse.json({ error: "지원하지 않는 전문 분야입니다." }, { status: 400 });
    changes.expertise_area = body.expertise_area;
  }
  for (const field of ["perspective", "case_evidence", "differentiator"] as const) {
    if (field in body) changes[field] = typeof body[field] === "string" && body[field].trim() ? body[field].trim() : null;
  }

  const { data, error } = await createAdminClient()
    .from("column_expert_knowledge")
    .update(changes)
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID가 필요합니다." }, { status: 400 });
  const { error } = await createAdminClient().from("column_expert_knowledge").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

