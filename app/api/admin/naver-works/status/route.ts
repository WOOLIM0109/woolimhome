import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { supportedPortfolioFile } from "@/lib/naver-works/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  const [{ data: connection, error }, { count: fileCount }, { data: allCandidates }] = await Promise.all([
    admin.from("naver_works_connections")
      .select("status,scopes,connected_by,connected_at,token_expires_at,last_refreshed_at,last_error")
      .eq("id", "primary").single(),
    admin.from("naver_works_drive_files").select("id", { count: "exact", head: true }),
    admin.from("portfolio_candidates")
      .select("id,project_name,status,quality_score,privacy_risk,font_status,selection_reasons,created_at,naver_works_drive_files(file_name,file_path,file_extension,file_size,modified_at)")
      .order("quality_score", { ascending: false })
      .limit(5000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const usable = (allCandidates || []).filter((candidate) => {
    const driveFile = Array.isArray(candidate.naver_works_drive_files)
      ? candidate.naver_works_drive_files[0]
      : candidate.naver_works_drive_files;
    return Boolean(driveFile) && supportedPortfolioFile({
      fileName: driveFile.file_name,
      filePath: driveFile.file_path,
    });
  });
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
    candidates: candidates.slice(0, 12),
  });
}
