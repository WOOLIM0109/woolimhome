import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { prepareNextPortfolioCandidate } from "@/lib/naver-works/portfolio-pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const prepared = await prepareNextPortfolioCandidate();
    if (!prepared) {
      return NextResponse.json({
        prepared: null,
        message: "현재 자동 기준을 통과한 새 디자인 프로젝트 후보가 없습니다.",
      });
    }
    return NextResponse.json({
      prepared,
      message: `${prepared.projectName} 프로젝트를 비공개 제작 작업으로 등록했습니다.`,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "포트폴리오 준비 실패",
    }, { status: 500 });
  }
}
