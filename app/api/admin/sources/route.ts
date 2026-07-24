import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await contentAdmin()
    .from("content_source_registry").select("*").order("source_grade").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
