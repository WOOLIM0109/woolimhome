import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = contentAdmin();
  const [{ data: connection, error }, { count: fileCount }, { count: candidateCount }, { data: candidates }] = await Promise.all([
    admin.from("naver_works_connections")
      .select("status,scopes,connected_by,connected_at,token_expires_at,last_refreshed_at,last_error")
      .eq("id", "primary").single(),
    admin.from("naver_works_drive_files").select("id", { count: "exact", head: true }),
    admin.from("portfolio_candidates").select("id", { count: "exact", head: true }),
    admin.from("portfolio_candidates")
      .select("id,project_name,status,quality_score,privacy_risk,font_status,selection_reasons,created_at,naver_works_drive_files(file_name,file_extension,file_size,modified_at)")
      .order("quality_score", { ascending: false })
      .limit(12),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    configured: Boolean(
      process.env.NAVER_WORKS_CLIENT_ID
      && process.env.NAVER_WORKS_CLIENT_SECRET
      && process.env.DRIVE_TOKEN_ENCRYPTION_KEY,
    ),
    connection,
    fileCount: fileCount || 0,
    candidateCount: candidateCount || 0,
    candidates: candidates || [],
  });
}
