import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { rewritePendingPartnerStyle } from "@/lib/content-ops/style-revision";
import type { ContentChannel } from "@/lib/content-ops/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const channel = body.channel as ContentChannel | undefined;
  if (channel !== "naver_consulting" && channel !== "naver_design") {
    return NextResponse.json({ error: "컨설팅 또는 디자인 블로그 채널을 선택해 주세요." }, { status: 400 });
  }
  try {
    return NextResponse.json(await rewritePendingPartnerStyle(channel, user.email || "admin"));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "대기 원고의 말투를 수정하지 못했습니다.",
    }, { status: 500 });
  }
}
