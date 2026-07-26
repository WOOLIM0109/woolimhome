import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { driveFileFingerprint, listDriveRoot, supportedPortfolioFile } from "@/lib/naver-works/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const admin = contentAdmin();
    const { data: root, error: rootError } = await admin.from("naver_works_drive_roots")
      .select("id").eq("connection_id", "primary").eq("drive_type", "my_drive").is("root_file_id", null)
      .maybeSingle();
    if (rootError) throw new Error(rootError.message);
    let rootId = root?.id as string | undefined;
    if (!rootId) {
      const { data: created, error: createError } = await admin.from("naver_works_drive_roots").insert({
        connection_id: "primary",
        drive_type: "my_drive",
        display_name: "NAVER WORKS 내 드라이브",
      }).select("id").single();
      if (createError) throw new Error(createError.message);
      rootId = created.id;
    }

    let cursor: string | undefined;
    let indexed = 0;
    let supported = 0;
    do {
      const page = await listDriveRoot(cursor);
      const rows = page.files.map((file) => {
        const isSupported = supportedPortfolioFile(file);
        if (isSupported) supported += 1;
        return {
          root_id: rootId,
          external_file_id: file.fileId,
          parent_file_id: file.parentFileId || null,
          file_path: file.filePath || "",
          file_name: file.fileName,
          file_extension: file.fileExtension || file.fileName.split(".").pop()?.toLowerCase() || null,
          file_type: file.fileType,
          file_size: file.fileSize || 0,
          modified_at: file.modifiedTime || null,
          fingerprint: driveFileFingerprint(file),
          supported: isSupported,
          sync_status: "indexed",
          raw_metadata: file,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length) {
        const { data: indexedFiles, error } = await admin.from("naver_works_drive_files")
          .upsert(rows, { onConflict: "root_id,external_file_id" })
          .select("id,file_name,file_extension,file_size,file_path,supported");
        if (error) throw new Error(error.message);
        const candidates = (indexedFiles || [])
          .filter((file) => file.supported)
          .map((file) => {
            const sizeMegabytes = Number(file.file_size || 0) / 1024 / 1024;
            const qualityScore = Math.min(95, 45 + Math.min(35, sizeMegabytes * 2));
            const projectName = file.file_name.replace(/\.(ppt|pptx|pdf)$/i, "");
            return {
              drive_file_id: file.id,
              project_key: `${file.file_path || ""}/${projectName}`.toLowerCase(),
              project_name: projectName,
              status: "candidate",
              quality_score: Math.round(qualityScore * 100) / 100,
              duplicate_score: 0,
              privacy_risk: "unknown",
              font_status: "unchecked",
              selection_reasons: [
                "PPT·PPTX·PDF 원본 파일",
                sizeMegabytes >= 5 ? "시각 자료가 충분할 가능성이 높은 파일" : "포트폴리오 검토 가능 파일",
              ],
              metadata: { source: "naver_works_drive", fileSizeMegabytes: Math.round(sizeMegabytes * 10) / 10 },
              updated_at: new Date().toISOString(),
            };
          });
        if (candidates.length) {
          const { error: candidateError } = await admin.from("portfolio_candidates")
            .upsert(candidates, { onConflict: "drive_file_id", ignoreDuplicates: true });
          if (candidateError) throw new Error(candidateError.message);
        }
        indexed += rows.length;
      }
      cursor = page.responseMetaData?.nextCursor || undefined;
    } while (cursor && indexed < 1000);

    await admin.from("naver_works_drive_roots").update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", rootId);
    return NextResponse.json({ indexed, supported, note: "1차 연결 시험은 내 드라이브 루트 파일을 최대 1,000개까지 색인합니다." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "동기화 실패" }, { status: 500 });
  }
}
