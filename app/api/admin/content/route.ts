import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { sanitizeWorkItemMetadata } from "@/lib/security/html";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  let query = contentAdmin()
    .from("content_work_items")
    .select("*, content_review_assets(*)")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (channel) query = query.eq("channel", channel);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (data || []).map((item) => ({
    ...item,
    metadata: sanitizeWorkItemMetadata(item.metadata),
  }));
  return NextResponse.json(items, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.channel || !body.format || !body.title) {
    return NextResponse.json({ error: "채널, 형식, 제목은 필수입니다." }, { status: 400 });
  }
  const { data, error } = await contentAdmin().from("content_work_items").insert({
    channel: body.channel,
    format: body.format,
    title: body.title,
    summary: body.summary || "",
    status: body.status || "topic_candidate",
    source_label: body.source_label || null,
    source_reference: body.source_reference || null,
    scheduled_at: body.scheduled_at || null,
    metadata: sanitizeWorkItemMetadata(body.metadata || {}),
    created_by: user.email,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
