import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { readPortfolioDedupeInventory } from "@/lib/portfolio/dedupe-inventory";
import { deterministicShortlist, driveFile, metadataEligible } from "@/lib/naver-works/portfolio-selection";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Read-only preview. No queue, conversion, token refresh, mockup or Gemini call. */
export async function GET(request: Request) {
  if (!await authenticatedAdmin()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { count, error } = await contentAdmin().from("content_work_items").select("id", { head: true, count: "exact" })
    .eq("channel", "naver_design").eq("status", "on_hold");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (count) return NextResponse.json({ error: "보류 작업 정리 후 미리보기를 실행해 주세요.", onHoldCount: count }, { status: 409 });
  const threshold = Number(new URL(request.url).searchParams.get("threshold") ?? 4);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 8) return NextResponse.json({ error: "해시 기준은 0~8 정수입니다." }, { status: 400 });
  try {
    const inventory = await readPortfolioDedupeInventory(threshold, { readOnly: true });
    const top10 = deterministicShortlist(inventory.accepted.filter(metadataEligible)).map(rank => {
      const candidate = inventory.accepted.find(candidate => candidate.id === rank.id)!;
      return { ...rank, title: candidate.project_name, file: driveFile(candidate)?.file_name,
        reasons: ["프로젝트명·발행 원장·대표 이미지 중복 검사 통과", ...rank.reasons] };
    });
    return NextResponse.json({ readOnly: true, threshold, top10, groups: inventory.groups,
      sourceFailures: inventory.sourceFailures, inspectionMetrics: inventory.metrics,
      excluded: inventory.decisions.filter(row => row.match || row.fontExclusionReason).map(row => ({ id: row.candidate.id, title: row.candidate.project_name,
        duplicateScore: row.duplicateScore, distance: row.distance, reason: row.reason, match: row.match })),
      reviewRequired: inventory.decisions.filter(row => !row.normalizedName).map(row => ({ id: row.candidate.id, title: row.candidate.project_name, reason: row.reason }))
        .concat(inventory.needsImageReview.map(row => ({ id: row.id, title: row.project_name, reason: "변환 전 대표 이미지 확인 필요" })))
        .concat(inventory.needsFontReview.map(row => ({ id: row.id, title: row.project_name, reason: "변환 전 원본 글꼴 확인 필요" }))),
      files: inventory.decisions.map(row => ({ id: row.candidate.id, title: row.candidate.project_name, file: driveFile(row.candidate),
        normalizedName: row.normalizedName })),
      sourcePreference: "PPTX 우선 → 최신 수정일 우선 → 사본 후순위",
      productionStarted: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "미리보기 조회 실패" }, { status: 500 });
  }
}
