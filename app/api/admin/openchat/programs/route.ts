import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { kstDate } from "@/lib/openchat/utils";
import type { OpenchatProgramStatus } from "@/lib/openchat/types";
import { MORNING_PROGRAM_LIMIT } from "@/lib/openchat/config";
import { nextBusinessDay } from "@/lib/openchat/operations";

export const dynamic = "force-dynamic";

const STATUSES: OpenchatProgramStatus[] = [
  "collected", "review_required", "approved", "deferred", "excluded", "ready", "published",
];

export async function GET(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || kstDate();
  const includeExcluded = url.searchParams.get("includeExcluded") === "true";
  const deferredOnly = url.searchParams.get("deferredOnly") === "true";
  let query = contentAdmin().from("openchat_programs")
    .select("*, source:openchat_sources(name,category,source_key)");
  query = deferredOnly
    ? query.eq("status", "deferred")
    : query.eq("draft_for", date);
  query = query
    .order("draft_for", { ascending: true })
    .order("priority")
    .order("deadline_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (!includeExcluded) query = query.neq("status", "excluded");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "공고 ID가 필요합니다." }, { status: 400 });
  if (body.status && !STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "지원하지 않는 상태입니다." }, { status: 400 });
  }
  const allowed = [
    "title", "applicant_summary", "support_summary", "application_method", "application_period_text", "source_url",
    "starts_at", "deadline_at", "regions", "categories", "priority", "draft_for",
    "status", "review_note", "exclusion_reason",
  ];
  const patch = Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
  if (body.status === "approved") {
    const draftFor = body.draft_for || kstDate();
    const { count, error: countError } = await contentAdmin().from("openchat_programs")
      .select("id", { count: "exact", head: true })
      .eq("draft_for", draftFor)
      .in("status", ["approved", "ready"])
      .neq("id", body.id);
    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    if ((count || 0) >= MORNING_PROGRAM_LIMIT) {
      return NextResponse.json({ error: `하루 승인 상한은 ${MORNING_PROGRAM_LIMIT}건입니다.` }, { status: 409 });
    }
    Object.assign(patch, { approved_at: new Date().toISOString(), approved_by: user.email });
  }
  if (body.status === "deferred") {
    Object.assign(patch, { draft_for: await nextBusinessDay(body.draft_for || kstDate()) });
  }
  if (body.status === "published") Object.assign(patch, { published_at: new Date().toISOString() });
  Object.assign(patch, { updated_at: new Date().toISOString() });
  const { data, error } = await contentAdmin().from("openchat_programs")
    .update(patch)
    .eq("id", body.id)
    .select("*, source:openchat_sources(name,category,source_key)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
