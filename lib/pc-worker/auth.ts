import { NextResponse } from "next/server";

export const PC_WORKER_ID = "becky-office-pc";

export function authorizeWorker(request: Request) {
  const expected = process.env.PC_WORKER_SECRET;
  const supplied = request.headers.get("authorization");
  if (!expected || supplied !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  }
  return null;
}

export function workerBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://woolim-site.vercel.app";
}
