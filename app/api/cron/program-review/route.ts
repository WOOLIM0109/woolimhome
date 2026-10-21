import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { runProgramReviewCron } from "@/lib/program-review/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) {
    unauthorized.headers.set("Cache-Control", "no-store");
    return unauthorized;
  }
  try {
    const result = await runProgramReviewCron();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never return provider diagnostics, source data, credentials, or customer fields.
    return NextResponse.json({ status: "failed", failed: 1 }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
