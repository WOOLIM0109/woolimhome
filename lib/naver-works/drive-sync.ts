/**
 * NAVER WORKS 드라이브를 훑어 포트폴리오 후보를 채웁니다.
 *
 * 원래 관리자 라우트 안에만 있어서, 사람이 버튼을 눌러야만 돌았습니다.
 * 마지막으로 누른 것이 7월 27일이었고, 그때 들어온 재료를 8월 4일에 다 쓴 뒤
 * 22일 동안 후보가 0이었습니다. 크론은 매시간 정상으로 돌았지만 쓸 것이
 * 없었습니다.
 *
 * 그래서 크론도 부를 수 있게 여기로 옮겼습니다. 관리자 라우트는 이 함수를
 * 부르는 얇은 껍데기가 됩니다.
 */

import {
  driveFileFingerprint,
  listDriveChildren,
  listDriveRoot,
  listSharedDriveChildren,
  listSharedDriveRoot,
  listSharedDrives,
  listSharedFolderChildren,
  listSharedFolderRoot,
  listSharedFolders,
  supportedPortfolioFile,
  type WorksDriveFile,
} from "./client";
import { contentAdmin } from "@/lib/content-ops/data";

type PageResult = {
  files: WorksDriveFile[];
  responseMetaData?: { nextCursor?: string };
};

type FileLister = (cursor?: string) => Promise<PageResult>;
type ChildLister = (fileId: string, cursor?: string) => Promise<PageResult>;
type FolderTarget = { fileId: string; filePath: string };

async function ensureRoot(
  driveType: "my_drive" | "shared_drive" | "shared_folder",
  displayName: string,
  externalDriveId?: string,
  rootFileId?: string,
) {
  const admin = contentAdmin();
  let query = admin.from("naver_works_drive_roots")
    .select("id")
    .eq("connection_id", "primary")
    .eq("drive_type", driveType);
  query = externalDriveId
    ? query.eq("external_drive_id", externalDriveId)
    : query.is("external_drive_id", null);
  const { data: root, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (root?.id) return root.id as string;
  const { data: created, error: createError } = await admin.from("naver_works_drive_roots").insert({
    connection_id: "primary",
    drive_type: driveType,
    display_name: displayName,
    external_drive_id: externalDriveId || null,
    root_file_id: rootFileId || null,
  }).select("id").single();
  if (createError) throw new Error(createError.message);
  return created.id as string;
}

async function saveFiles(rootId: string, files: WorksDriveFile[]) {
  if (!files.length) return { indexed: 0, supported: 0 };
  const admin = contentAdmin();
  const now = new Date().toISOString();
  const rows = files.map((file) => ({
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
    supported: supportedPortfolioFile(file),
    sync_status: "indexed",
    raw_metadata: file,
    last_seen_at: now,
    updated_at: now,
  }));
  const { data: indexedFiles, error } = await admin.from("naver_works_drive_files")
    .upsert(rows, { onConflict: "root_id,external_file_id" })
    .select("id,file_name,file_extension,file_size,file_path,supported");
  if (error) throw new Error(error.message);
  const candidates = (indexedFiles || []).filter((file) => file.supported).map((file) => {
    const sizeMegabytes = Number(file.file_size || 0) / 1024 / 1024;
    const projectName = file.file_name.replace(/\.(ppt|pptx|pdf)$/i, "");
    return {
      drive_file_id: file.id,
      project_key: `${file.file_path || ""}/${projectName}`.toLowerCase(),
      project_name: projectName,
      status: "candidate",
      quality_score: Math.round(Math.min(95, 45 + Math.min(35, sizeMegabytes * 2)) * 100) / 100,
      duplicate_score: 0,
      privacy_risk: "unknown",
      font_status: "unchecked",
      selection_reasons: [
        "PPT·PPTX·PDF 원본 파일",
        sizeMegabytes >= 5 ? "시각 자료가 충분할 가능성이 높은 파일" : "포트폴리오 검토 가능 파일",
      ],
      metadata: {
        source: "naver_works_drive",
        fileSizeMegabytes: Math.round(sizeMegabytes * 10) / 10,
      },
      updated_at: now,
    };
  });
  if (candidates.length) {
    const { error: candidateError } = await admin.from("portfolio_candidates")
      .upsert(candidates, { onConflict: "drive_file_id", ignoreDuplicates: true });
    if (candidateError) throw new Error(candidateError.message);
  }
  const excludedFileIds = (indexedFiles || [])
    .filter((file) => !file.supported)
    .map((file) => file.id);
  if (excludedFileIds.length) {
    const { error: cleanupError } = await admin.from("portfolio_candidates")
      .update({
        status: "excluded",
        exclusion_reasons: ["완성본_외부공유금지/PPT 폴더 밖의 자료"],
        updated_at: now,
      })
      .in("drive_file_id", excludedFileIds);
    if (cleanupError) throw new Error(cleanupError.message);
  }
  return { indexed: rows.length, supported: candidates.length };
}

function portfolioFolderPath(filePath: string) {
  const segments = filePath
    .split(/[\\/>]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const completedRoot = segments.findIndex((segment) => segment === "완성본_외부공유금지");
  if (completedRoot < 0) return false;
  const nextFolder = segments[completedRoot + 1];
  return !nextFolder || nextFolder.toLowerCase() === "ppt";
}

async function crawlRoot(
  rootId: string,
  rootPath: string,
  rootLister: FileLister,
  childLister: ChildLister,
  limit = 1000,
) {
  let indexed = 0;
  let supported = 0;
  const folders: FolderTarget[] = [];
  const deadline = Date.now() + 40_000;

  async function consume(lister: FileLister, parentPath: string) {
    let cursor: string | undefined;
    do {
      const page = await lister(cursor);
      const remaining = Math.max(0, limit - indexed);
      const files = page.files.slice(0, remaining).map((file) => ({
        ...file,
        filePath: `${parentPath}/${file.fileName}`,
      }));
      const saved = await saveFiles(rootId, files);
      indexed += saved.indexed;
      supported += saved.supported;
      const discoveredFolders = files
        .filter((file) => file.fileType === "FOLDER")
        .filter((file) => portfolioFolderPath(file.filePath || ""))
        .sort((a, b) => {
          const priority = (name: string) => {
            if (name === "완성본_외부공유금지") return 3;
            if (name.toLowerCase() === "ppt") return 2;
            if (name === "레퍼런스") return -1;
            return /포트폴리오|디자인|제안서|사업계획서|ir/i.test(name) ? 1 : 0;
          };
          const aPriority = priority(a.fileName);
          const bPriority = priority(b.fileName);
          return bPriority - aPriority;
        })
        .map((file) => ({
          fileId: file.fileId,
          filePath: file.filePath || `${parentPath}/${file.fileName}`,
        }));
      folders.push(...discoveredFolders);
      cursor = page.responseMetaData?.nextCursor;
    } while (cursor && indexed < limit && Date.now() < deadline);
  }

  await consume(rootLister, rootPath);
  while (folders.length && indexed < limit && Date.now() < deadline) {
    const folder = folders.shift()!;
    await consume((cursor) => childLister(folder.fileId, cursor), folder.filePath);
  }
  await contentAdmin().from("naver_works_drive_roots").update({
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", rootId);
  return { indexed, supported };
}

async function crawlSharedDrives(limit = 1000) {
  let indexed = 0;
  let supported = 0;
  const page = await listSharedDrives();
  const drives = [...(page.sharedrives || [])].sort((a, b) => {
    const aPriority = /ppt|포트폴리오|디자인/i.test(a.name) ? 1 : 0;
    const bPriority = /ppt|포트폴리오|디자인/i.test(b.name) ? 1 : 0;
    return bPriority - aPriority;
  });
  for (const drive of drives) {
    const rootId = await ensureRoot("shared_drive", drive.name, drive.sharedriveId);
    const result = await crawlRoot(
      rootId,
      drive.name,
      (cursor) => listSharedDriveRoot(drive.sharedriveId, cursor),
      (fileId, cursor) => listSharedDriveChildren(drive.sharedriveId, fileId, cursor),
      Math.max(1, limit - indexed),
    );
    indexed += result.indexed;
    supported += result.supported;
    if (indexed >= limit) break;
  }
  return { indexed, supported, driveCount: drives.length };
}

async function removeIneligibleCandidates() {
  const admin = contentAdmin();
  const { data, error } = await admin.from("naver_works_drive_files")
    .select("id,file_name,file_path")
    .limit(5000);
  if (error) throw new Error(error.message);
  const ids = (data || [])
    .filter((file) => !supportedPortfolioFile({
      fileName: file.file_name,
      filePath: file.file_path,
    }))
    .map((file) => file.id);
  let excludedCandidates = 0;
  const preservedWorkItemIds = new Set<string>();
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const { data: invalidCandidates, error: candidateReadError } = await admin
      .from("portfolio_candidates")
      .select("id,metadata")
      .in("drive_file_id", chunk);
    if (candidateReadError) throw new Error(candidateReadError.message);
    const workItemIds = (invalidCandidates || [])
      .map((candidate) => candidate.metadata?.workItemId)
      .filter((value): value is string => typeof value === "string");
    const { error: cleanupError } = await admin.from("portfolio_candidates")
      .update({
        status: "excluded",
        exclusion_reasons: ["완성본_외부공유금지/PPT 폴더 밖의 자료"],
        updated_at: new Date().toISOString(),
      })
      .in("drive_file_id", chunk);
    if (cleanupError) throw new Error(cleanupError.message);
    excludedCandidates += invalidCandidates?.length || 0;
    workItemIds.forEach((id) => preservedWorkItemIds.add(id));
    const { error: fileError } = await admin.from("naver_works_drive_files")
      .update({ supported: false, updated_at: new Date().toISOString() })
      .in("id", chunk);
    if (fileError) throw new Error(fileError.message);
  }
  return {
    excludedCandidates,
    preservedWorkItems: preservedWorkItemIds.size,
  };
}

export type DriveSyncResult = {
  indexed: number;
  supported: number;
  source: string;
  cleanup: Awaited<ReturnType<typeof removeIneligibleCandidates>>;
  note: string;
};

export async function syncNaverWorksDrive(): Promise<DriveSyncResult> {

    let indexed = 0;
    let supported = 0;
    let source = "내 드라이브";

    try {
      const myRootId = await ensureRoot("my_drive", "NAVER WORKS 내 드라이브");
      const result = await crawlRoot(
        myRootId,
        "NAVER WORKS 내 드라이브",
        listDriveRoot,
        listDriveChildren,
      );
      indexed += result.indexed;
      supported += result.supported;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("My Drive is not available")) throw error;
      source = "초대받은 공유 폴더와 공용 드라이브";
      let cursor: string | undefined;
      let folderCount = 0;
      do {
        const page = await listSharedFolders(cursor);
        const prioritizedFolders = [...page.sharedFolders].sort((a, b) => {
          const aPriority = /디자인|포트폴리오|ppt|인수인계|블로그/i.test(a.sharedFolderName) ? 1 : 0;
          const bPriority = /디자인|포트폴리오|ppt|인수인계|블로그/i.test(b.sharedFolderName) ? 1 : 0;
          return bPriority - aPriority;
        });
        for (const folder of prioritizedFolders) {
          const rootId = await ensureRoot(
            "shared_folder",
            folder.sharedFolderName,
            folder.sharedFolderId,
            folder.rootFileId,
          );
          const remaining = Math.max(1, 1000 - indexed);
          const result = await crawlRoot(
            rootId,
            folder.sharedFolderName,
            (pageCursor) => listSharedFolderRoot(folder.sharedFolderId, pageCursor),
            (fileId, pageCursor) => listSharedFolderChildren(folder.sharedFolderId, fileId, pageCursor),
            remaining,
          );
          indexed += result.indexed;
          supported += result.supported;
          folderCount += 1;
          if (indexed >= 1000) break;
        }
        cursor = page.responseMetaData?.nextCursor;
      } while (cursor && indexed < 1000);
      const sharedDriveResult = indexed < 1000
        ? await crawlSharedDrives(Math.max(1, 1000 - indexed))
        : { indexed: 0, supported: 0, driveCount: 0 };
      indexed += sharedDriveResult.indexed;
      supported += sharedDriveResult.supported;
      if (!folderCount && !sharedDriveResult.driveCount) {
        throw new Error("현재 계정에 초대받은 공유 폴더가 없습니다. NAVER WORKS에서 프로젝트 폴더를 이 계정에 공유해 주세요.");
      }
    }

    const cleanup = await removeIneligibleCandidates();
    return {
      indexed,
      supported,
      source,
      cleanup,
      note: `${source}의 '완성본_외부공유금지/PPT' 폴더에서 최대 1,000개까지 확인했습니다.`,
    };
}
