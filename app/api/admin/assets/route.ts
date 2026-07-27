import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket");
  const path = url.searchParams.get("path");
  if (!bucket || !path || !["portfolio-rendered"].includes(bucket) || path.includes("..")) {
    return NextResponse.json({ error: "Invalid asset." }, { status: 400 });
  }
  const { data, error } = await contentAdmin().storage.from(bucket).download(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Not found." }, { status: 404 });
  return new NextResponse(data, {
    headers: {
      "content-type": data.type || (path.endsWith(".png") ? "image/png" : "application/octet-stream"),
      "cache-control": "private, max-age=300",
    },
  });
}
