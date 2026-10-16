import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Read-only deployment proof for the separately approved cleanup command. */
export async function GET() {
  return NextResponse.json({ version: "project-dedupe-v1", environment: process.env.VERCEL_ENV || "development",
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null }, { headers: { "Cache-Control": "no-store" } });
}
