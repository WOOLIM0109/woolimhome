/**
 * 보존 정책 실태 집계.
 *
 * 아무것도 지우지 않습니다. 정책을 실제로 켜면 무엇이 얼마나 정리될지
 * 숫자로만 보여 줍니다. 얼마나 쌓였는지 모르는 상태에서 보존 기간을
 * 정하면 틀리고, 삭제는 되돌릴 수 없습니다. 그래서 삭제보다 이 집계가
 * 먼저입니다.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { RETENTION_RULES, retentionCutoff, type RetentionRule } from "@/lib/retention/policy";

/** 한 번에 훑을 최대 행 수. 여기 걸리면 결과에 truncated 로 알립니다. */
const SCAN_LIMIT = 5_000;
const SCAN_PAGE = 1_000;

export type RetentionSurveyEntry = {
  key: string;
  label: string;
  action: RetentionRule["action"];
  table: string;
  bucket?: string;
  afterDays: number;
  cutoff: string;
  /** 정리 대상이 되는 행 수. */
  rows: number;
  /** 정리 대상이 되는 스토리지 파일 수. 파일 규칙에만 채웁니다. */
  files?: number;
  /** 집계가 스캔 상한에 걸려 실제보다 적게 세었는지. */
  truncated?: boolean;
  /** 집계 방식이 실제 규칙과 다른 지점. 숫자를 그대로 믿지 않게 적어 둡니다. */
  note?: string;
  /** 집계에 실패해도 나머지 항목은 살립니다. */
  error?: string;
};

export type RetentionSurvey = {
  dryRun: true;
  surveyedAt: string;
  entries: RetentionSurveyEntry[];
  totals: { rows: number; files: number; failed: number };
};

type Admin = ReturnType<typeof createAdminClient>;
type Counter = (admin: Admin, cutoff: string) => Promise<Partial<RetentionSurveyEntry>>;

type CountResult = { count: number | null; error: { message: string } | null };

/** 행을 가져오지 않고 개수만 셉니다. head:true 라 본문은 오지 않습니다. */
async function counted(query: PromiseLike<CountResult>) {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: count || 0 };
}

function countQuery(admin: Admin, table: string) {
  return admin.from(table).select("id", { count: "exact", head: true });
}

/** 발행이 끝나고 기준일이 지난 작업의 id 를 모읍니다. */
async function publishedWorkItemIds(admin: Admin, cutoff: string) {
  const ids: string[] = [];
  for (let from = 0; from < SCAN_LIMIT; from += SCAN_PAGE) {
    const { data, error } = await admin
      .from("content_work_items")
      .select("id")
      .eq("status", "published")
      .lt("published_at", cutoff)
      .range(from, from + SCAN_PAGE - 1);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((row) => row.id as string));
    if (!data || data.length < SCAN_PAGE) return { ids, truncated: false };
  }
  return { ids, truncated: true };
}

const COUNTERS: Record<string, Counter> = {
  // 원본 PPTX 는 작업 metadata 에 업로드 기록이 남아 있는 건이 대상입니다.
  portfolio_source_files: async (admin) => {
    const { count, error } = await admin
      .from("content_work_items")
      .select("id", { count: "exact", head: true })
      .not("metadata->portfolioSourceUpload", "is", null);
    if (error) throw new Error(error.message);
    return {
      rows: count || 0,
      files: count || 0,
      note: "변환 성공 여부는 작업 기록을 함께 봐야 확정됩니다. 여기 숫자는 상한입니다.",
    };
  },

  // 슬라이드 PNG 는 변환 작업 결과에 경로가 통째로 들어 있습니다.
  portfolio_rendered_slides: async (admin, cutoff) => {
    let rows = 0;
    let files = 0;
    let truncated = true;
    for (let from = 0; from < SCAN_LIMIT; from += SCAN_PAGE) {
      const { data, error } = await admin
        .from("content_jobs")
        .select("id,result")
        .eq("job_type", "convert")
        .eq("status", "completed")
        .lt("updated_at", cutoff)
        .range(from, from + SCAN_PAGE - 1);
      if (error) throw new Error(error.message);
      for (const job of data || []) {
        const paths = (job.result as { slidePaths?: unknown })?.slidePaths;
        if (!Array.isArray(paths) || !paths.length) continue;
        rows += 1;
        files += paths.length;
      }
      if (!data || data.length < SCAN_PAGE) {
        truncated = false;
        break;
      }
    }
    return {
      rows,
      files,
      truncated,
      note: "초안 완료까지 확인하면 실제 대상은 이보다 적습니다. 상한으로 보세요.",
    };
  },

  published_review_assets: async (admin, cutoff) => {
    const { ids, truncated } = await publishedWorkItemIds(admin, cutoff);
    if (!ids.length) return { rows: 0, files: 0, truncated };
    let rows = 0;
    for (let index = 0; index < ids.length; index += 100) {
      const { count, error } = await admin
        .from("content_review_assets")
        .select("id", { count: "exact", head: true })
        .in("work_item_id", ids.slice(index, index + 100));
      if (error) throw new Error(error.message);
      rows += count || 0;
    }
    return { rows, files: rows, truncated };
  },

  published_work_item_body: async (admin, cutoff) => counted(
    countQuery(admin, "content_work_items")
      .eq("status", "published")
      .lt("published_at", cutoff)
      .not("metadata->generated", "is", null),
  ),

  published_openchat_draft_body: async (admin, cutoff) => counted(
    countQuery(admin, "openchat_content_drafts")
      .eq("status", "published")
      .lt("published_at", cutoff)
      .neq("body", ""),
  ),

  excluded_candidate_metadata: async (admin, cutoff) => counted(
    countQuery(admin, "portfolio_candidates").eq("status", "excluded").lt("updated_at", cutoff),
  ),

  finished_content_jobs: async (admin, cutoff) => counted(
    // 진행 중이거나 재시도를 기다리는 작업은 세지도 않습니다.
    countQuery(admin, "content_jobs").in("status", ["completed", "failed"]).lt("updated_at", cutoff),
  ),

  column_generation_runs: async (admin, cutoff) => counted(
    countQuery(admin, "column_generation_runs").lt("created_at", cutoff),
  ),

  bot_traffic_logs: async (admin, cutoff) => counted(
    countQuery(admin, "bot_traffic_logs").lt("accessed_at", cutoff),
  ),

  openchat_run_logs: async (admin, cutoff) => counted(
    countQuery(admin, "openchat_run_logs").lt("started_at", cutoff),
  ),

  content_automation_runs: async (admin, cutoff) => counted(
    // 리스를 들고 있는 실행을 지우면 같은 작업이 두 번 돕니다.
    countQuery(admin, "content_automation_runs").neq("status", "running").lt("scheduled_for", cutoff),
  ),

  reviewed_source_changes: async (admin, cutoff) => counted(
    countQuery(admin, "content_source_changes").not("reviewed_at", "is", null).lt("reviewed_at", cutoff),
  ),

  column_editorial_feedback: async (admin, cutoff) => counted(
    countQuery(admin, "column_editorial_feedback").lt("created_at", cutoff),
  ),

  stale_drive_files: async (admin, cutoff) => counted(
    countQuery(admin, "naver_works_drive_files").eq("sync_status", "ignored").lt("last_seen_at", cutoff),
  ),

  stale_push_subscriptions: async (admin, cutoff) => counted(
    countQuery(admin, "openchat_push_subscriptions").lt("updated_at", cutoff),
  ),
};

export async function surveyRetention(now = new Date()): Promise<RetentionSurvey> {
  const admin = createAdminClient();
  const entries: RetentionSurveyEntry[] = [];

  for (const rule of RETENTION_RULES) {
    const cutoff = retentionCutoff(rule, now);
    const base: RetentionSurveyEntry = {
      key: rule.key,
      label: rule.label,
      action: rule.action,
      table: rule.table,
      ...(rule.bucket ? { bucket: rule.bucket } : {}),
      afterDays: rule.afterDays,
      cutoff,
      rows: 0,
    };
    const counter = COUNTERS[rule.key];
    if (!counter) {
      entries.push({ ...base, error: "집계 방법이 정의되지 않았습니다." });
      continue;
    }
    try {
      entries.push({ ...base, ...await counter(admin, cutoff) });
    } catch (error) {
      // 한 항목이 실패해도 나머지 숫자는 봐야 합니다.
      entries.push({
        ...base,
        error: error instanceof Error ? error.message : "집계 실패",
      });
    }
  }

  return {
    dryRun: true,
    surveyedAt: now.toISOString(),
    entries,
    totals: {
      rows: entries.reduce((sum, entry) => sum + (entry.error ? 0 : entry.rows), 0),
      files: entries.reduce((sum, entry) => sum + (entry.error ? 0 : entry.files || 0), 0),
      failed: entries.filter((entry) => entry.error).length,
    },
  };
}
