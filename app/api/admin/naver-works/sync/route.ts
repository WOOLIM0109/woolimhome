import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { syncNaverWorksDrive } from "@/lib/naver-works/drive-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
 * 관리자가 손으로 누르는 동기화입니다.
 *
 * 실제 작업은 lib/naver-works/drive-sync.ts 가 합니다. 예전에는 이 라우트
 * 안에만 있어서 크론이 부를 수 없었고, 사람이 누르지 않으면 후보가 영영
 * 채워지지 않았습니다.
 */
export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncNaverWorksDrive();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "동기화 실패",
    }, { status: 500 });
  }
}
