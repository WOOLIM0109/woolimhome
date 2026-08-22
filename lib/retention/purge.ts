/**
 * 보존 정책 실행.
 *
 * survey.ts 가 세기만 한다면 이 파일은 실제로 지웁니다. 되돌릴 수 없는
 * 일이라 규칙마다 지키는 조건을 코드에 그대로 옮겨 두었습니다.
 *
 * 한 번에 다 지우지 않습니다. 규칙마다 상한을 두고, 남은 것이 있으면
 * remaining 으로 알린 뒤 다음 실행에서 이어서 처리합니다. 첫 실행에서
 * 수십만 행을 한꺼번에 지우면 테이블이 잠깁니다.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { parseStoredAssetUrl } from "@/lib/partner-portal";
import { RETENTION_RULES, retentionCutoff, type RetentionRule } from "@/lib/retention/policy";

/** 한 규칙이 한 실행에서 건드릴 수 있는 최대 행 수. */
const ROW_BATCH = 1_000;
/** 낙관적 잠금 때문에 한 행씩 고쳐야 하는 규칙의 상한. 왕복이 그만큼 늘어납니다. */
const ROW_LOOP_BATCH = 200;
/** 스토리지를 만지는 규칙은 왕복이 더 많아 좁게 잡습니다. */
const FILE_BATCH = 50;
/**
 * id 목록을 한 번에 몇 개까지 실어 보낼지.
 *
 * PostgREST 는 조건을 URL 에 담습니다. UUID 하나가 37자라 천 개를 그대로
 * 실으면 37KB 짜리 주소가 되어 게이트웨이가 잘라 버립니다.
 */
const ID_CHUNK = 100;

export type RetentionPurgeEntry = {
  key: string;
  label: string;
  action: RetentionRule["action"];
  table: string;
  bucket?: string;
  afterDays: number;
  cutoff: string;
  /** 실제로 지우거나 비운 행 수. */
  rows: number;
  /** 실제로 지운 스토리지 파일 수. */
  files?: number;
  /** 상한에 걸려 다음 실행으로 넘긴 것이 있는지. */
  remaining?: boolean;
  /** 파일은 못 지웠지만 행은 정리한 경우처럼, 반쪽만 된 상황을 알립니다. */
  warnings?: string[];
  error?: string;
};

export type RetentionPurgeReport = {
  dryRun: false;
  purgedAt: string;
  entries: RetentionPurgeEntry[];
  totals: { rows: number; files: number; failed: number; remaining: number };
};

type Admin = ReturnType<typeof createAdminClient>;
type Purger = (admin: Admin, cutoff: string) => Promise<Partial<RetentionPurgeEntry>>;

type IdRow = { id: string };

/** 지울 행의 id 만 상한까지 뽑습니다. */
async function idsToPurge(query: PromiseLike<{ data: IdRow[] | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const ids = (data || []).map((row) => row.id);
  return { ids, remaining: ids.length >= ROW_BATCH };
}

async function deleteByIds(admin: Admin, table: string, ids: string[]) {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK);
    const { error } = await admin.from(table).delete().in("id", chunk);
    if (error) throw new Error(error.message);
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * 준 id 들 가운데 발행이 끝나고 기준일이 지난 것만 남깁니다.
 *
 * 반대 방향으로 짜면 안 됩니다. 발행 작업을 먼저 뽑고 그 안에서 지울 것을
 * 찾으면, 앞쪽 작업이 모두 정리된 뒤에도 매번 같은 것들만 다시 뽑혀서
 * 뒤쪽은 영영 차례가 오지 않습니다.
 */
async function keepPurgeablePublished(admin: Admin, workItemIds: string[], cutoff: string) {
  const purgeable = new Set<string>();
  for (let index = 0; index < workItemIds.length; index += ID_CHUNK) {
    const { data, error } = await admin
      .from("content_work_items")
      .select("id")
      .in("id", workItemIds.slice(index, index + ID_CHUNK))
      .eq("status", "published")
      .lt("published_at", cutoff);
    if (error) throw new Error(error.message);
    for (const row of data || []) purgeable.add(row.id as string);
  }
  return purgeable;
}

/**
 * 아직 정리하지 않은 작업 기록을 오래된 것부터 훑습니다.
 *
 * 오래된 것이 먼저 발행되었을 가능성이 높아, 이 순서면 매 실행마다
 * 실제로 지울 것이 나옵니다.
 */
async function unpurgedJobs(admin: Admin, jobType: string, marker: string) {
  const { data, error } = await admin
    .from("content_jobs")
    .select("id,work_item_id,result,updated_at")
    .eq("job_type", jobType)
    .eq("status", "completed")
    .not("work_item_id", "is", null)
    .is(`result->>${marker}`, null)
    .order("updated_at", { ascending: true })
    .limit(ID_CHUNK);
  if (error) throw new Error(error.message);
  return data || [];
}

async function removeFiles(admin: Admin, bucket: string, paths: string[], warnings: string[]) {
  if (!paths.length) return 0;
  const { error } = await admin.storage.from(bucket).remove(paths);
  if (error) {
    // 파일을 못 지웠으면 표시도 남기지 않습니다. 다음 실행에서 다시 시도합니다.
    warnings.push(`${bucket}: ${error.message}`);
    return 0;
  }
  return paths.length;
}

const PURGERS: Record<string, Purger> = {
  /**
   * 발행이 끝난 작업의 원본 PPTX.
   *
   * 변환 직후가 아니라 발행 뒤에 지웁니다. retryPortfolioConversion 이
   * 다운로드 작업 결과의 storagePath 를 요구하기 때문입니다.
   */
  portfolio_source_files: async (admin, cutoff) => {
    const warnings: string[] = [];
    const candidates = await unpurgedJobs(admin, "download", "purgedAt");
    if (!candidates.length) return { rows: 0, files: 0 };
    const purgeable = await keepPurgeablePublished(
      admin,
      candidates.map((job) => job.work_item_id as string),
      cutoff,
    );
    const jobs = candidates
      .filter((job) => purgeable.has(job.work_item_id as string))
      .slice(0, FILE_BATCH);

    let rows = 0;
    let files = 0;
    for (const job of jobs) {
      const result = (job.result || {}) as Record<string, unknown>;
      const bucket = typeof result.bucket === "string" ? result.bucket : null;
      const path = typeof result.storagePath === "string" ? result.storagePath : null;
      // 드라이브에서 PC 가 직접 받은 건은 스토리지에 사본이 없습니다.
      if (!bucket || !path) continue;
      const removed = await removeFiles(admin, bucket, [path], warnings);
      if (!removed) continue;
      const { error: markError } = await admin.from("content_jobs")
        .update({
          result: { ...result, purgedAt: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("updated_at", job.updated_at);
      if (markError) throw new Error(markError.message);
      rows += 1;
      files += removed;
    }
    return { rows, files, remaining: jobs.length >= FILE_BATCH, warnings };
  },

  /**
   * 발행이 끝난 작업의 슬라이드 PNG.
   *
   * 경로는 지우지 않고 남겨 둡니다. 무엇을 지웠는지 기록이 되고,
   * slidesPurgedAt 이 다음 실행에서 같은 작업을 다시 집지 않게 막습니다.
   */
  portfolio_rendered_slides: async (admin, cutoff) => {
    const warnings: string[] = [];
    const candidates = await unpurgedJobs(admin, "convert", "slidesPurgedAt");
    if (!candidates.length) return { rows: 0, files: 0 };
    const purgeable = await keepPurgeablePublished(
      admin,
      candidates.map((job) => job.work_item_id as string),
      cutoff,
    );
    const jobs = candidates
      .filter((job) => purgeable.has(job.work_item_id as string))
      .slice(0, FILE_BATCH);

    let rows = 0;
    let files = 0;
    for (const job of jobs) {
      const result = (job.result || {}) as Record<string, unknown>;
      const bucket = typeof result.bucket === "string" ? result.bucket : null;
      const paths = Array.isArray(result.slidePaths)
        ? result.slidePaths.filter((value): value is string => typeof value === "string")
        : [];
      if (!bucket || !paths.length) continue;
      const removed = await removeFiles(admin, bucket, paths, warnings);
      if (!removed) continue;
      const { error: markError } = await admin.from("content_jobs")
        .update({
          result: { ...result, slidesPurgedAt: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("updated_at", job.updated_at);
      if (markError) throw new Error(markError.message);
      rows += 1;
      files += removed;
    }
    return { rows, files, remaining: jobs.length >= FILE_BATCH, warnings };
  },

  /**
   * 발행이 끝난 검토용 이미지.
   *
   * 행을 지우는 규칙이라 남은 이미지가 곧 남은 일감입니다. 매 실행마다
   * 대상이 줄어들어 앞에서와 같은 순서 문제가 없습니다.
   */
  published_review_assets: async (admin, cutoff) => {
    const warnings: string[] = [];
    const { data: assets, error } = await admin
      .from("content_review_assets")
      .select("id,public_url,work_item_id")
      // 오래된 것부터 봅니다. 아직 발행되지 않은 작업의 이미지가 앞을 막아
      // 뒤쪽 차례가 오지 않는 일을 피하려는 순서입니다.
      .order("created_at", { ascending: true })
      .limit(ROW_BATCH);
    if (error) throw new Error(error.message);
    if (!assets?.length) return { rows: 0, files: 0 };
    const purgeable = await keepPurgeablePublished(
      admin,
      [...new Set(assets.map((asset) => asset.work_item_id as string))],
      cutoff,
    );
    const targets = assets.filter((asset) => purgeable.has(asset.work_item_id as string));
    if (!targets.length) return { rows: 0, files: 0, remaining: assets.length >= ROW_BATCH };

    // 우리 스토리지에 있는 것만 지웁니다. 네이버에 올라간 주소는 대상이 아닙니다.
    const stored = targets
      .map((asset) => parseStoredAssetUrl(asset.public_url as string))
      .filter((value): value is { bucket: string; path: string } => Boolean(value));
    let files = 0;
    for (const bucket of [...new Set(stored.map((asset) => asset.bucket))]) {
      const paths = stored.filter((asset) => asset.bucket === bucket).map((asset) => asset.path);
      for (let index = 0; index < paths.length; index += ID_CHUNK) {
        files += await removeFiles(admin, bucket, paths.slice(index, index + ID_CHUNK), warnings);
      }
    }
    const rows = await deleteByIds(admin, "content_review_assets", targets.map((asset) => asset.id as string));
    return { rows, files, remaining: assets.length >= ROW_BATCH, warnings };
  },

  /**
   * 발행이 끝난 원고 본문.
   *
   * 행은 남깁니다. published_url_normalized 유니크 제약이 같은 글을 두 번
   * 발행하는 걸 막는 유일한 장치라, 행이 사라지면 중복 차단이 풀립니다.
   */
  published_work_item_body: async (admin, cutoff) => {
    const { data: items, error } = await admin
      .from("content_work_items")
      .select("id,metadata,updated_at")
      .eq("status", "published")
      .lt("published_at", cutoff)
      .not("metadata->generated", "is", null)
      .limit(ROW_LOOP_BATCH);
    if (error) throw new Error(error.message);

    let rows = 0;
    for (const item of items || []) {
      const metadata = { ...(item.metadata || {}) as Record<string, unknown> };
      delete metadata.generated;
      metadata.bodyPurgedAt = new Date().toISOString();
      const { data: saved, error: saveError } = await admin.from("content_work_items")
        .update({ metadata, updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("updated_at", item.updated_at)
        .select("id")
        .maybeSingle();
      if (saveError) throw new Error(saveError.message);
      // 그 사이 누가 고쳤으면 건너뜁니다. 다음 실행에서 다시 봅니다.
      if (saved) rows += 1;
    }
    return { rows, remaining: (items || []).length >= ROW_LOOP_BATCH };
  },

  /** 발행이 끝난 오픈채팅 초안 본문. content_date 가 유니크라 행은 남깁니다. */
  published_openchat_draft_body: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("openchat_content_drafts")
        .select("id")
        .eq("status", "published")
        .lt("published_at", cutoff)
        .neq("body", "")
        .limit(ROW_BATCH),
    );
    for (let index = 0; index < ids.length; index += ID_CHUNK) {
      const { error } = await admin.from("openchat_content_drafts")
        .update({ body: "", updated_at: new Date().toISOString() })
        .in("id", ids.slice(index, index + ID_CHUNK));
      if (error) throw new Error(error.message);
    }
    return { rows: ids.length, remaining };
  },

  /**
   * 탈락한 포트폴리오 후보의 부가 정보.
   *
   * 행을 지우면 드라이브 동기화가 같은 파일을 새 후보로 다시 만들어
   * 변환과 AI 검토를 되풀이합니다. 그래서 metadata 만 비우되,
   * 동기화가 읽는 workItemId 는 남깁니다.
   */
  excluded_candidate_metadata: async (admin, cutoff) => {
    const { data: candidates, error } = await admin
      .from("portfolio_candidates")
      .select("id,metadata,updated_at")
      .eq("status", "excluded")
      .lt("updated_at", cutoff)
      .is("metadata->>metadataPurgedAt", null)
      .limit(ROW_LOOP_BATCH);
    if (error) throw new Error(error.message);

    let rows = 0;
    for (const candidate of candidates || []) {
      const metadata = (candidate.metadata || {}) as Record<string, unknown>;
      const kept: Record<string, unknown> = { metadataPurgedAt: new Date().toISOString() };
      if (typeof metadata.workItemId === "string") kept.workItemId = metadata.workItemId;
      const { data: saved, error: saveError } = await admin.from("portfolio_candidates")
        .update({ metadata: kept, updated_at: new Date().toISOString() })
        .eq("id", candidate.id)
        .eq("updated_at", candidate.updated_at)
        .select("id")
        .maybeSingle();
      if (saveError) throw new Error(saveError.message);
      if (saved) rows += 1;
    }
    return { rows, remaining: (candidates || []).length >= ROW_LOOP_BATCH };
  },

  /** 끝난 작업 기록. 진행 중이거나 재시도를 기다리는 작업은 건드리지 않습니다. */
  finished_content_jobs: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("content_jobs")
        .select("id")
        .in("status", ["completed", "failed"])
        .lt("updated_at", cutoff)
        .limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "content_jobs", ids), remaining };
  },

  column_generation_runs: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("column_generation_runs").select("id").lt("created_at", cutoff).limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "column_generation_runs", ids), remaining };
  },

  bot_traffic_logs: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("bot_traffic_logs").select("id").lt("accessed_at", cutoff).limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "bot_traffic_logs", ids), remaining };
  },

  openchat_run_logs: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("openchat_run_logs").select("id").lt("started_at", cutoff).limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "openchat_run_logs", ids), remaining };
  },

  /** 리스를 들고 있는 실행을 지우면 같은 작업이 두 번 돕니다. */
  content_automation_runs: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("content_automation_runs")
        .select("id")
        .neq("status", "running")
        .lt("scheduled_for", cutoff)
        .limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "content_automation_runs", ids), remaining };
  },

  /** 미검토 건은 남깁니다. 최근 것은 같은 변경의 재감지를 막는 근거입니다. */
  reviewed_source_changes: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("content_source_changes")
        .select("id")
        .not("reviewed_at", "is", null)
        .lt("reviewed_at", cutoff)
        .limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "content_source_changes", ids), remaining };
  },

  column_editorial_feedback: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("column_editorial_feedback").select("id").lt("created_at", cutoff).limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "column_editorial_feedback", ids), remaining };
  },

  /** 후보가 참조하는 행은 외래키로 묶여 있어 ignored 인 것만 지웁니다. */
  stale_drive_files: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("naver_works_drive_files")
        .select("id")
        .eq("sync_status", "ignored")
        .lt("last_seen_at", cutoff)
        .limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "naver_works_drive_files", ids), remaining };
  },

  stale_push_subscriptions: async (admin, cutoff) => {
    const { ids, remaining } = await idsToPurge(
      admin.from("openchat_push_subscriptions").select("id").lt("updated_at", cutoff).limit(ROW_BATCH),
    );
    return { rows: await deleteByIds(admin, "openchat_push_subscriptions", ids), remaining };
  },
};

export async function purgeRetention(now = new Date()): Promise<RetentionPurgeReport> {
  const admin = createAdminClient();
  const entries: RetentionPurgeEntry[] = [];

  for (const rule of RETENTION_RULES) {
    const cutoff = retentionCutoff(rule, now);
    const base: RetentionPurgeEntry = {
      key: rule.key,
      label: rule.label,
      action: rule.action,
      table: rule.table,
      ...(rule.bucket ? { bucket: rule.bucket } : {}),
      afterDays: rule.afterDays,
      cutoff,
      rows: 0,
    };
    const purger = PURGERS[rule.key];
    if (!purger) {
      entries.push({ ...base, error: "정리 방법이 정의되지 않았습니다." });
      continue;
    }
    try {
      const result = await purger(admin, cutoff);
      // 경고가 비어 있으면 결과에 싣지 않습니다.
      if (Array.isArray(result.warnings) && !result.warnings.length) delete result.warnings;
      entries.push({ ...base, ...result });
    } catch (error) {
      // 한 규칙이 막혀도 나머지는 정리합니다.
      entries.push({
        ...base,
        error: error instanceof Error ? error.message : "정리 실패",
      });
    }
  }

  return {
    dryRun: false,
    purgedAt: now.toISOString(),
    entries,
    totals: {
      rows: entries.reduce((sum, entry) => sum + entry.rows, 0),
      files: entries.reduce((sum, entry) => sum + (entry.files || 0), 0),
      failed: entries.filter((entry) => entry.error).length,
      remaining: entries.filter((entry) => entry.remaining).length,
    },
  };
}
