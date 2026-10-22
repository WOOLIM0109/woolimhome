import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { supportedPortfolioFile } from "@/lib/naver-works/client";
import { readPortfolioDedupeInventory } from "@/lib/portfolio/dedupe-inventory";
import { sourceInspectionState } from "@/lib/portfolio/source-inspection";
import { portfolioFontExclusion } from "@/lib/portfolio/font-policy";
import { normalizePortfolioProjectName } from "@/lib/portfolio/project-name";
import { driveFile, metadataEligible } from "@/lib/naver-works/portfolio-selection";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  try {
  const [{ data: connection, error }, { count: fileCount, error: fileCountError }, inventory, { data: portfolioItems, error: itemsError }] = await Promise.all([
    admin.from("naver_works_connections")
      .select("status,scopes,connected_by,connected_at,token_expires_at,last_refreshed_at,last_error")
      .eq("id", "primary").single(),
    admin.from("naver_works_drive_files").select("id", { count: "exact", head: true }),
    (async () => {
      const { data: control, error: controlError } = await admin.from("portfolio_automation_control")
        .select("hash_threshold").eq("id", true).single();
      if (controlError) throw new Error(controlError.message);
      return readPortfolioDedupeInventory(control.hash_threshold ?? 4, { readOnly: true });
    })(),
    admin.from("content_work_items").select("id,title,status")
      .eq("channel", "naver_design").eq("format", "portfolio")
      .in("status", ["researching", "creating", "draft_waiting", "on_hold", "review_required"]),
  ]);
  if (error || fileCountError || itemsError) return NextResponse.json({ error: error?.message || fileCountError?.message || itemsError?.message }, { status: 500 });
  const usable = inventory.candidates.filter((candidate) => {
    const driveFile = Array.isArray(candidate.naver_works_drive_files)
      ? candidate.naver_works_drive_files[0]
      : candidate.naver_works_drive_files;
    return Boolean(driveFile) && supportedPortfolioFile({
      fileName: driveFile.file_name,
      filePath: driveFile.file_path,
    });
  }).sort((left, right) => right.quality_score - left.quality_score);
  /*
   * '후보'는 아직 쓰지 않은 것만 셉니다.
   *
   * 예전에는 폴더와 확장자만 보고 세서, 이미 제외된 것과 이미 다 쓴 것까지
   * 전부 합쳐졌습니다. 그래서 실제로 쓸 수 있는 후보가 0 이던 22 일 동안에도
   * 화면에는 '후보 21개'가 떠 있었고, 넉넉해 보이는 숫자 때문에 아무도
   * 후보가 마른 줄 몰랐습니다. 정작 알아야 할 것을 가리던 숫자입니다.
   */
  const candidates = usable.filter((candidate) => candidate.status === "candidate");
  const statusCounts = usable.reduce<Record<string, number>>((counts, candidate) => {
    const key = String(candidate.status || "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const inspectionCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    const state = sourceInspectionState(candidate);
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
  const activePortfolioItems = (portfolioItems || []).filter(item => ["researching", "creating", "draft_waiting"].includes(item.status));
  const heldPortfolioItems = (portfolioItems || []).filter(item => ["on_hold", "review_required"].includes(item.status));
  return NextResponse.json({
    configured: Boolean(
      process.env.NAVER_WORKS_CLIENT_ID
      && process.env.NAVER_WORKS_CLIENT_SECRET
      && process.env.DRIVE_TOKEN_ENCRYPTION_KEY,
    ),
    connection,
    fileCount: fileCount || 0,
    /** 아직 쓰지 않고 기다리는 후보. 이 값이 0 이면 다음 회차가 빈손이 됩니다. */
    candidateCount: candidates.length,
    /** 승인 폴더 안의 전체 건수. 상태별 내역과 함께 보여 줘야 오해가 없습니다. */
    trackedCount: usable.length,
    statusCounts,
    inspectionSummary: {
      producible: inventory.accepted.filter(metadataEligible).length,
      pending: inspectionCounts.pending || 0,
      noPreview: inspectionCounts.no_preview || 0,
      tooLarge: inspectionCounts.too_large || 0,
      failed: inspectionCounts.failed || 0,
    },
    inspectionMetrics: inventory.metrics,
    activePortfolioCount: activePortfolioItems.length,
    heldPortfolioItems,
    candidates: usable.map(candidate => {
      const file = driveFile(candidate);
      return {
        ...candidate,
        fileName: file?.file_name || candidate.project_name,
        fileSize: file?.file_size || 0,
        normalizedProjectName: normalizePortfolioProjectName(file?.file_name || ""),
        fontExclusionReason: portfolioFontExclusion(candidate),
        metadata: { ...candidate.metadata, inspectionState: sourceInspectionState(candidate) },
      };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "후보 상태를 확인하지 못했습니다." }, { status: 500 });
  }
}
