import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { kstDate } from "@/lib/openchat/utils";
import type { OpenchatContentStatus } from "@/lib/openchat/types";

export const dynamic = "force-dynamic";

const STATUSES: OpenchatContentStatus[] = [
  "topic_candidate", "review_required", "approved", "deferred", "ready", "published", "on_hold",
];

export async function GET(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || kstDate();
  const { data, error } = await contentAdmin().from("openchat_content_drafts")
    .select("*")
    .eq("content_date", date)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "콘텐츠 ID가 필요합니다." }, { status: 400 });
  if (body.status && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "지원하지 않는 상태입니다." }, { status: 400 });
  }
  const allowed = ["title", "body", "reference_urls", "keywords", "status", "review_note"];
  const patch = Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
  if (body.status === "approved") Object.assign(patch, { approved_at: new Date().toISOString(), approved_by: user.email });
  if (body.status === "published") Object.assign(patch, { published_at: new Date().toISOString() });
  Object.assign(patch, { updated_at: new Date().toISOString() });
  const admin = contentAdmin();
  const { data, error } = await admin.from("openchat_content_drafts")
    .update(patch)
    .eq("id", body.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.status === "published") {
    await admin.from("openchat_content_history").upsert({
      published_on: data.content_date,
      content_kind: "afternoon",
      title: data.title,
      summary: data.body.slice(0, 500),
      keywords: data.keywords,
      source_label: "자동화 관리자 게시 완료",
    }, { onConflict: "published_on,title" });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "콘텐츠 ID가 필요합니다." }, { status: 400 });
  const { error } = await contentAdmin().from("openchat_content_drafts")
    .delete()
    .eq("id", body.id)
    .in("status", ["topic_candidate", "review_required", "deferred", "on_hold"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
