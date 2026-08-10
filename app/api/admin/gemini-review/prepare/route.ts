import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareGeminiReview } from "@/lib/gemini/review-service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await prepareGeminiReview(body.items, user.email));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "호출 내용을 확인하지 못했습니다." }, { status: 400 });
  }
}
