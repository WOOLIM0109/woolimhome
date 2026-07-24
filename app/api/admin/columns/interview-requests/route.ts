import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { ensureInterviewRequest, EXPERTISE_AREAS } from "@/lib/columns/interview-requests";
import type { ExpertiseArea } from "@/lib/columns/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

async function adminUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email) ? user : null;
}

export async function GET() {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient()
    .from("column_interview_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const area = body.expertiseArea as ExpertiseArea | undefined;
  if (area && !EXPERTISE_AREAS.some((item) => item.value === area)) {
    return NextResponse.json({ error: "올바른 전문 분야를 선택해 주세요." }, { status: 400 });
  }
  try {
    const result = await ensureInterviewRequest({
      createdBy: user.email || "admin",
      expertiseArea: area,
      force: Boolean(body.force),
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "인터뷰 요청서 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id || !["pending", "completed"].includes(body.status)) {
    return NextResponse.json({ error: "요청서와 상태를 확인해 주세요." }, { status: 400 });
  }
  const completed = body.status === "completed";
  const { data, error } = await createAdminClient()
    .from("column_interview_requests")
    .update({ status: body.status, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
