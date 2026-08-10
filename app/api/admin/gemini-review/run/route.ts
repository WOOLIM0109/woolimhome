import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { runGeminiReview } from "@/lib/gemini/review-service";

export const runtime = "nodejs";
// Two 90-second transport windows plus one bounded retry delay and DB writes.
export const maxDuration = 240;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await runGeminiReview(body.items, user.email, body.confirmationToken));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 검수를 실행하지 못했습니다.";
    const status = /상한|실행 중|차단|비활성화|확인/.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
