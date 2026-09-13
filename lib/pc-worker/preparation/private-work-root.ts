import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type PrivateWorkRootPaths = Readonly<{
  sourcePath: string;
  workRoot: string;
}>;

const SYNC_DIRECTORY_PATTERNS = [
  /^onedrive(?:\s*-\s*.+)?$/i,
  /^dropbox(?:\s*\(.+\))?$/i,
  /^icloud\s*drive$/i,
  /^googledrive$/i,
  /^google\s+drive(?:\s+file\s+stream)?$/i,
] as const;

function privateRootError(message: string): never {
  throw new Error(`PRIVATE_LOCAL_WORK_ROOT_REQUIRED: ${message}`);
}

function dedicatedRootError(message: string): never {
  throw new Error(`DEDICATED_WORK_ROOT_REQUIRED: ${message}`);
}

function pathSegments(absolutePath: string) {
  const root = path.parse(absolutePath).root;
  const relative = absolutePath.slice(root.length);
  return {
    root,
    segments: relative.split(path.sep).filter(Boolean),
  };
}

function isSameOrInside(parentPath: string, candidatePath: string) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ""
    || (relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function isKnownSyncPath(value: string) {
  return value
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SYNC_DIRECTORY_PATTERNS.some((pattern) => pattern.test(segment.trim())));
}

async function canonicalizeProspectiveWorkRoot(inputPath: string) {
  const resolved = path.resolve(inputPath);
  const { root, segments } = pathSegments(resolved);
  let cursor = root;
  let existingCursor = root;
  let missingFrom = segments.length;

  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missingFrom = index;
        break;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      privateRootError(`작업 폴더 경로에 링크 또는 정션이 포함되어 있습니다: ${cursor}`);
    }
    if (!info.isDirectory()) {
      privateRootError(`작업 폴더 경로의 상위 항목이 디렉터리가 아닙니다: ${cursor}`);
    }
    existingCursor = cursor;
  }

  const canonicalAncestor = await realpath(existingCursor);
  const prospectiveSegments = segments.slice(missingFrom);
  return path.resolve(canonicalAncestor, ...prospectiveSegments);
}

/**
 * Resolves a source file and a not-yet-created local preparation directory
 * without creating the directory. Source links are allowed because the source
 * is read-only; links and junctions on the private work-root side are not.
 */
export async function assertPrivateWorkRoot(
  sourcePathInput: string,
  workRootInput: string,
): Promise<PrivateWorkRootPaths> {
  const sourcePath = await realpath(path.resolve(sourcePathInput));
  const workRoot = await canonicalizeProspectiveWorkRoot(workRootInput);

  if (isKnownSyncPath(workRoot)) {
    privateRootError("무블러 작업 폴더는 OneDrive, Dropbox, iCloudDrive, GoogleDrive 밖에 두세요.");
  }

  const sourceDirectory = path.dirname(sourcePath);
  if (isSameOrInside(sourceDirectory, workRoot)) {
    dedicatedRootError("작업 폴더를 원본 파일 폴더 안에 둘 수 없습니다.");
  }
  if (isSameOrInside(workRoot, sourcePath)) {
    dedicatedRootError("원본 파일을 작업 폴더 안에 둘 수 없습니다.");
  }

  return { sourcePath, workRoot };
}
