/**
 * 같은 공고 두 줄을 한 줄로 접습니다.
 *
 * 어느 줄이 같은 공고인지는 `dedupe.ts` 가 가립니다. 이 파일은 **어느 줄을
 * 남길지** 고르고, 나머지를 '제외' 로 돌립니다.
 *
 * 지우지 않습니다. `status` 를 `excluded` 로 바꾸고 사유를 적어 둘 뿐이라,
 * 틀렸으면 사유로 골라서 되살릴 수 있습니다:
 *
 *     update openchat_programs set status='review_required', exclusion_reason=null
 *      where exclusion_reason = '<DUPLICATE_REASON>';
 *
 * 남길 줄을 고르는 순서 (실측 2026-11-06 에서 나온 순서입니다):
 *   1. **사람이 판단을 내린 줄.** 승인·발행대기·보류는 건드리지 않습니다.
 *      둘 이상이면 아예 접지 않습니다 — 기계가 사람 판단을 지우면 안 됩니다.
 *   2. **요건을 뽑아 둔 줄.** 뽑는 데 돈이 들었습니다. LG디스플레이 공고는
 *      기업마당 줄에 요건이 없고 K-Startup 줄에 있었습니다. 기업마당 줄을
 *      남기면 그 돈이 날아가고 아침 목록에 분야가 안 뜹니다.
 *   3. **주관기관이 적힌 줄.** 수집기가 올린 줄이라 값이 더 많습니다.
 *   4. 먼저 들어온 줄. 돌릴 때마다 같은 답이 나오게 하려는 것입니다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateGroups, type DedupeRow } from "./dedupe.ts";

/** 접은 줄에 남기는 사유. 되살릴 때 이것으로 고릅니다. */
export const DUPLICATE_REASON = "같은 공고가 다른 곳에서도 올라와 한 줄로 접었습니다 (중복 정리)";

/**
 * 접어도 되는 상태.
 *
 * `approved`·`ready` 는 발행을 기다리는 중이고 `deferred` 는 사람이 미뤄 둔
 * 것입니다. 건드리지 않습니다. `published` 는 이미 내보냈으니 접어도 기록이
 * 남습니다 — 아침 정독 목록에서만 빠집니다.
 */
export const FOLDABLE = new Set(["collected", "review_required", "published"]);

/** 화면에 보이는 범위. `list_openchat_requirement_work` 와 같은 60일입니다. */
const SHOWN_FOR_DAYS = 60;

type Row = Record<string, unknown>;

export type FoldDependencies = {
  admin: Pick<SupabaseClient, "from">;
  now?: () => Date;
};

export type FoldResult = {
  /** 본 줄 수 */
  considered: number;
  /** 같은 공고로 묶인 묶음 수 */
  groups: number;
  /** '제외' 로 돌린 줄 수 */
  folded: number;
  /** 손대지 않은 묶음 수 — 사람 판단이 둘 이상이거나 접을 줄이 없는 묶음 */
  skipped: number;
};

class FoldError extends Error {}

function fail(error: { message?: string } | null, where: string): never {
  throw new FoldError(`${where}: ${error?.message ?? "알 수 없는 오류"}`.slice(0, 200));
}

type Candidate = DedupeRow & {
  status: string;
  createdAt: string;
  reviewNote: string | null;
  /** 요건을 뽑아 둔 시각. 없으면 안 뽑은 줄입니다. */
  extractedAt: string | null;
};

/** 남길 줄 하나를 고릅니다. 고를 수 없으면 `null` — 그 묶음은 접지 않습니다. */
export function chooseSurvivor(members: readonly Candidate[]): Candidate | null {
  const decided = members.filter((row) => !FOLDABLE.has(row.status));
  // 사람이 판단을 내린 줄이 둘 이상이면 손대지 않습니다.
  if (decided.length > 1) return null;
  if (decided.length === 1) return decided[0];
  const rank = (row: Candidate) => [
    row.extractedAt ? 0 : 1,                    // 요건을 뽑아 둔 줄이 먼저
    row.extractedAt ? -Date.parse(row.extractedAt) : 0,  // 그중 최근에 뽑은 줄
    row.orgName ? 0 : 1,                        // 주관기관이 적힌 줄
    Date.parse(row.createdAt) || 0,             // 먼저 들어온 줄
  ];
  return [...members].sort((left, right) => {
    const a = rank(left), b = rank(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return left.id < right.id ? -1 : 1;         // 그래도 같으면 id 순 — 답이 흔들리지 않게
  })[0] ?? null;
}

/**
 * 살아 있는 공고를 훑어 같은 공고 두 줄을 한 줄로 접습니다.
 *
 * 몇 번 돌려도 결과가 같습니다 — 접은 줄은 `excluded` 가 되어 다음 번에는
 * 아예 보이지 않습니다.
 */
export async function foldDuplicatePrograms(
  { admin, now = () => new Date() }: FoldDependencies,
): Promise<FoldResult> {
  const moment = now();
  const since = new Date(moment.getTime() - SHOWN_FOR_DAYS * 86_400_000).toISOString();
  const { data: rows, error } = await admin.from("openchat_programs")
    .select("id,title,org_name,regions,deadline_at,source_id,status,created_at,review_note")
    .neq("status", "excluded")
    .gte("created_at", since)
    .or(`deadline_at.is.null,deadline_at.gte.${moment.toISOString()}`)
    .order("created_at", { ascending: true })
    .order("id");
  if (error) fail(error, "공고 조회 실패");

  const programs = (rows ?? []) as Row[];
  const result: FoldResult = { considered: programs.length, groups: 0, folded: 0, skipped: 0 };
  if (programs.length < 2) return result;

  // 요건을 뽑아 둔 줄을 알아 둡니다. 돈을 들여 뽑은 쪽을 남겨야 합니다.
  const extractedAt = new Map<string, string>();
  const ids = programs.map((row) => String(row.id));
  for (let start = 0; start < ids.length; start += 200) {
    const { data: requirements, error: requirementError } = await admin
      .from("openchat_program_requirements")
      .select("program_id,extracted_at")
      .eq("status", "extracted")
      .in("program_id", ids.slice(start, start + 200));
    if (requirementError) fail(requirementError, "요건 조회 실패");
    for (const row of (requirements ?? []) as Row[]) {
      const at = row.extracted_at ? String(row.extracted_at) : "";
      if (at) extractedAt.set(String(row.program_id), at);
    }
  }

  const candidates: Candidate[] = programs.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    sourceId: row.source_id ? String(row.source_id) : null,
    orgName: row.org_name ? String(row.org_name) : null,
    regions: Array.isArray(row.regions) ? row.regions.map(String) : null,
    deadlineAt: row.deadline_at ? String(row.deadline_at) : null,
    status: String(row.status ?? ""),
    createdAt: String(row.created_at ?? ""),
    reviewNote: row.review_note ? String(row.review_note) : null,
    extractedAt: extractedAt.get(String(row.id)) ?? null,
  }));

  for (const group of duplicateGroups(candidates)) {
    result.groups += 1;
    const survivor = chooseSurvivor(group.members);
    if (!survivor) { result.skipped += 1; continue; }
    const fold = group.members.filter((row) => row.id !== survivor.id && FOLDABLE.has(row.status));
    if (!fold.length) { result.skipped += 1; continue; }
    for (const row of fold) {
      // 어느 줄로 접었는지 남깁니다. 사람이 적어 둔 메모는 지우지 않습니다.
      const link = `같은 공고로 접었습니다 → ${survivor.title} (${survivor.id})`;
      const { error: updateError } = await admin.from("openchat_programs").update({
        status: "excluded",
        exclusion_reason: DUPLICATE_REASON,
        review_note: row.reviewNote ? `${row.reviewNote}\n\n${link}` : link,
        updated_at: moment.toISOString(),
      }).eq("id", row.id);
      if (updateError) fail(updateError, "접기 실패");
      result.folded += 1;
    }
  }
  return result;
}
