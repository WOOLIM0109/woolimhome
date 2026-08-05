import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  const [{ data: sources, error }, { data: runs }] = await Promise.all([
    admin.from("openchat_sources").select("*").order("priority"),
    admin.from("openchat_run_logs").select("*").order("started_at", { ascending: false }).limit(100),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources, runs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "출처 ID가 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Number.isFinite(Number(body.priority))) patch.priority = Number(body.priority);
  const { data, error } = await contentAdmin().from("openchat_sources")
    .update(patch).eq("id", body.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
