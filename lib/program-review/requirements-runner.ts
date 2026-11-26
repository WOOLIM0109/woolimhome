import { createAdminClient } from "../supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { parseGeminiJson } from "../gemini/json";
import { GEMINI_AUTOMATION_MODEL, GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "../gemini/automation";
import { buildRequirementInput, normalizeRequirements, requirementsPrompt, REQUIREMENTS_NORMALIZATION_VERSION, type Requirements } from "./requirements";
import { generateRequirementResponse, RequirementGenerationError, REQUIREMENTS_RESPONSE_MAX_TOKENS } from "./requirements-generation";
import { loadMatchProfilesSnapshot, MatchProfilesError } from "./profiles-run";
import { matchProgram } from "./matching";
import { withReviewJob } from "./jobs";

type Admin = ReturnType<typeof createAdminClient>;
type Options = {
  admin?: Admin; now?: () => number; limit?: number; programIds?: string[];
  includeExcluded?: boolean; recoveryProgramId?: string;
};
type Program = { id: string; deadline_at: string | null; created_at: string; status?: string };
const QUEUE_FIELDS = ["ready", "remaining", "eligible", "withText", "waitingAttachments",
  "requirementsExtracted", "requirementsFailed", "pendingInputChars"] as const;
type QueueCounts = Record<typeof QUEUE_FIELDS[number], number>;
// worker-ingest.ts 의 COLLECTOR_TAG 와 같은 값이다 (이 파일은 시험 상자에서 따로 읽혀 import 를 늘리지 않는다).
const COLLECTOR_TAG = "gonggo-monitor";
/**
 * 이 원문으로 이미 한 번 뽑기를 시도했는가. 그렇다면 `claim_openchat_requirement` 가 거절한다
 * (같은 원문은 두 번 부르지 않는다).
 */
async function attemptedBefore(admin: Admin, programId: string, inputHash: string) {
  const { data, error } = await admin.from("openchat_program_requirement_attempts")
    .select("program_id").eq("program_id", programId).eq("input_hash", inputHash).limit(1);
  if (error) throw new Error("요건 처리 이력 조회 실패");
  return Array.isArray(data) && data.length > 0;
}
/** 대표 PC 수집기가 넣은 공고인가. */
async function collectorOwned(admin: Admin, programId: string) {
  const { data, error } = await admin.from("openchat_programs")
    .select("collector:raw_payload->>collector").eq("id", programId).maybeSingle();
  if (error) throw new Error("요건 원문 조회 실패");
  return (data as { collector?: string | null } | null)?.collector === COLLECTOR_TAG;
}
/**
 * 이 판에 맞춰 판정한 것만 '끝났다' 고 본다. save_openchat_program_matches 가 적는 값과 같다.
 * SQL 에서 판을 올리면 여기도 올린다. 잊어도 날짜가 바뀌면 다시 판정하므로, 어긋나는 것은 그날 하루다.
 */
const MATCH_RULE_VERSION = 5;
/**
 * 글만 있는 수집기 공고를 한 번 실행에서 판정하는 건수와, 새 공고의 판정을 **시작하는** 시간.
 * (시작한 한 건은 끝까지 간다.) 남은 것은 다음 실행이 잇는다.
 * 실패가 이만큼 쌓이면 그친다 — 한 건만의 문제면 나머지는 판정되고, 전부 실패하는 날에는 시간을 태우지 않는다.
 */
const BODY_ONLY_BUDGET_MS = 60_000, BODY_ONLY_LIMIT = 100, BODY_ONLY_MAX_FAILURES = 3;
/** 원문이 본문 하나뿐인 요건인가 (수집기가 첨부 없이 보낸 공고). */
function bodyOnlyManifest(value: unknown) {
  return !Array.isArray(value) || value.length <= 1;
}
/**
 * 글만 있는 수집기 공고 가운데 **오늘 판정할 것**을 찾습니다 (2026-11-25).
 *
 * 작업 줄(list_openchat_requirement_work)은 글자가 뽑힌 첨부가 하나라도 있는 공고만
 * 세웁니다. 그런데 PC 수집기는 첨부가 없는 공고, 첨부가 포스터 그림·PPT·엑셀뿐인
 * 공고도 **본문에 글자를 합쳐** 요건까지 뽑아 보냅니다. 그 공고들은 요건이 있는데도
 * 줄에 서지 못해 고객사 판정을 한 번도 받지 못했습니다 (실측 2026-11-25: 살아 있는 43건).
 *
 * 여기서는 그런 공고만 따로 찾습니다. 요건은 뽑지 않습니다 — 수집기가 써 둔 요건으로
 * 판정만 합니다.
 *
 * 수집기가 쓴 요건인지는 이렇게 가립니다.
 *   - 공고가 수집기 것이고, 요건의 원문이 본문 하나뿐이다 (source_manifest 가 한 칸).
 *   - model 이 수집기 표시다 (2026-11-25 부터 받는 쪽이 남긴다). 또는 **비어 있다** —
 *     표시를 남기기 전에 받은 요건이다 (실측 43건 중 39건). 서버가 뽑으면 모델 이름이
 *     적히고, 서버는 첨부 글자가 없는 공고의 요건을 뽑지 않는다.
 *   빈 model 은 여기, 글만 있는 공고에서만 받아 준다. 첨부가 있는 공고는 표시가 있어야 믿는다.
 *
 * 판정이 끝났는지는 판정 저장(save_openchat_program_matches)이 요건 행에 남기는 칸으로
 * 따집니다 — 오늘 날짜 · 고객 프로필 판 · 판정 규칙 판 · 요건 판 · 원문 확인 시각.
 * 하나라도 다르면 다시 판정합니다. (작업 줄 SQL 은 '오늘 판정 줄이 실제로 있는가' 도
 * 보는데, 그것은 여기서 보지 않습니다.)
 */
async function bodyOnlyCollectorWork(admin: Admin, scope: {
  date: string; nowMs: number; profileRevision: number; includeExcluded: boolean;
  programIds?: string[]; skip: Set<string>;
}): Promise<Program[]> {
  const since = new Date(scope.nowMs - 60 * 86400_000).toISOString();
  // 요건은 공고가 들어온 뒤에 쓰이므로, 60일 안에 만든 공고의 요건은 모두 이 기간에 든다.
  // 판정한 지 오래된 것(한 번도 안 한 것 포함)부터 받는다 — 1000줄을 넘겨 잘리더라도
  // 오늘 이미 판정한 것이 먼저 잘린다. (지금은 수십 줄이다. 1000줄에 가까워지면
  // 마감 지난 공고의 옛 요건이 앞자리를 차지하므로, 그때는 SQL 로 옮겨야 한다.)
  const { data: rows, error } = await admin.from("openchat_program_requirements")
    .select("program_id,model,input_hash,normalization_version,source_manifest,source_checked_at,matched_review_date,"
      + "matched_profile_revision,matched_rule_version,matched_source_checked_at,matched_normalization_version")
    .eq("status", "extracted").is("source_manifest->1", null)
    .or(`model.is.null,model.eq.${COLLECTOR_TAG}`).gte("updated_at", since)
    .order("matched_review_date", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false }).limit(1000);
  if (error) throw new Error("글만 있는 공고 요건 조회 실패");
  type Row = { program_id: string; model: string | null; input_hash: string | null; normalization_version: number | null;
    source_manifest: unknown; source_checked_at: string | null; matched_review_date: string | null;
    matched_profile_revision: number | null; matched_rule_version: number | null;
    matched_source_checked_at: string | null; matched_normalization_version: number | null };
  const same = (left: string | null, right: string | null) =>
    left === right || (!!left && !!right && Date.parse(left) === Date.parse(right));
  const wanted = scope.programIds ? new Set(scope.programIds) : null;
  const due = ((rows ?? []) as unknown as Row[]).filter((row) =>
    (row.model === COLLECTOR_TAG || row.model == null)
    && bodyOnlyManifest(row.source_manifest)
    && typeof row.input_hash === "string" && !!row.input_hash
    && row.normalization_version === REQUIREMENTS_NORMALIZATION_VERSION
    && !scope.skip.has(row.program_id)
    && (!wanted || wanted.has(row.program_id))
    && !(row.matched_review_date === scope.date
      && Number(row.matched_profile_revision) === scope.profileRevision
      && Number(row.matched_rule_version) >= MATCH_RULE_VERSION
      && row.matched_normalization_version === row.normalization_version
      && same(row.matched_source_checked_at, row.source_checked_at)));
  const found: Program[] = [];
  for (let index = 0; index < due.length; index += 100) {
    const { data: programs, error: programError } = await admin.from("openchat_programs")
      .select("id,status,deadline_at,created_at,collector:raw_payload->>collector")
      .in("id", due.slice(index, index + 100).map((row) => row.program_id));
    if (programError) throw new Error("글만 있는 공고 조회 실패");
    for (const program of (programs ?? []) as unknown as (Program & { collector?: string | null })[]) {
      if (program.collector !== COLLECTOR_TAG) continue;
      if (!scope.includeExcluded && program.status === "excluded") continue;
      if (Date.parse(program.created_at) < scope.nowMs - 60 * 86400_000) continue;
      if (program.deadline_at && Date.parse(program.deadline_at) < scope.nowMs) continue;
      found.push({ id: program.id, deadline_at: program.deadline_at, created_at: program.created_at });
    }
  }
  // 마감이 가까운 것부터. 마감이 없는 것은 뒤로.
  return found.sort((left, right) =>
    (left.deadline_at ? Date.parse(left.deadline_at) : Infinity) - (right.deadline_at ? Date.parse(right.deadline_at) : Infinity)
    || left.id.localeCompare(right.id));
}
/** 원문을 다 읽지 못했거나 잘린 공고의 판정에는 '확인 필요' 를 덧붙인다. */
function withCautions<T extends { verdict: string; reasons: string[] }>(matches: T[], complete: boolean, truncated: boolean): T[] {
  const caution = [!complete ? "첨부 일부 미추출: 확인 필요" : "", truncated ? "입력 6만 자 절단: 확인 필요" : ""].filter(Boolean);
  if (!caution.length) return matches;
  return matches.map((m) => ({ ...m, reasons: [...m.reasons, ...caution,
    ...(m.verdict === "candidate" && !m.reasons.some((reason) => reason.startsWith("조건부 후보:"))
      ? ["조건부 후보: 첨부 원문 전체와 추가 요건은 확인 필요"] : [])] }));
}
class ReviewTimeDeferred extends Error {}
class RequirementTaskFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function boundedAdmin(clock: () => number, end: number): Admin {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("비공개 요건 처리 설정 없음");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(Math.max(1, Math.min(20_000, end - clock() - 1000))),
    ]) }) } });
}

/**
 * 비워진 요건을 저장해 둔 답에서 되살립니다. 유료 호출이 없습니다.
 *
 * 2026-11-05 저녁 17:55~17:57(KST) 사이에 살아 있는 공고 67건의 요건이
 * 한꺼번에 비워졌습니다. 모두 성공해서 저장까지 끝난 것이었습니다
 * (diagnostics stage='stored', extracted_at 있음). 같은 원문을 두 번 부르지
 * 않으려고 둔 가지가 그 행을 'failed' 로 바꾸고 requirements 를 null 로
 * 비웠습니다. 모델이 준 답은 그대로 남아 있었습니다 — 67건 전부 완전한
 * JSON 이었고 평균 5,900자였습니다(16k 한도와 무관).
 *
 * 그래서 다시 부르지 않고 그 답을 읽어 되살립니다. 다만 **지금 읽은 원문으로
 * 근거 검증을 다시 통과해야** 합니다. 원문이 그새 바뀌었으면 되살리지 않고
 * 유료 재시도로 넘깁니다 — 옛 답을 새 원문의 요건이라고 우기면 안 됩니다.
 *
 * 복구 기록을 먼저 봅니다. 사람이 나중에 부른 쪽이 더 최신입니다.
 */
async function restorableRequirements(
  admin: Admin, programId: string, input: ReturnType<typeof buildRequirementInput>,
) {
  for (const table of ["openchat_program_requirement_recoveries", "openchat_program_requirement_attempts"] as const) {
    const { data, error } = await admin.from(table).select("response_text,responded_at")
      .eq("program_id", programId).eq("input_hash", input.inputHash);
    if (error) throw new Error("저장해 둔 요건 응답 조회 실패");
    const text = ((data ?? []) as { response_text?: unknown; responded_at?: unknown }[])
      .filter((row) => typeof row.response_text === "string" && row.response_text.trim())
      .sort((left, right) => String(right.responded_at ?? "").localeCompare(String(left.responded_at ?? "")))[0]
      ?.response_text;
    if (typeof text !== "string") continue;
    // 근거가 지금 원문과 맞지 않으면 되살리지 않는다. 터뜨리지 않고 유료 재시도로 넘긴다.
    try { return normalizeRequirements(parseGeminiJson<unknown>(text), input); } catch { continue; }
  }
  return null;
}

/** Independent review work only. The lease also excludes concurrent attachment review work. */
export async function runRequirementsTask(options: Options = {}) {
  const clock = options.now ?? Date.now;
  const started = clock(), end = started + 240_000;
  // Leave a bounded database/lease-finalization tail after the 240-second work window.
  const admin = options.admin ?? boundedAdmin(clock, started + 280_000);
  return withReviewJob(admin, "requirements", async () => {
    const now = new Date(started);
    const date = new Date(started + 9 * 3600_000).toISOString().slice(0, 10);
    const includeExcluded = options.includeExcluded ?? true;
    const max = typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(Math.floor(options.limit), 100)) : 100;
    const summary = { date, profiles: 0, queued: 0, scopeProgramCount: options.recoveryProgramId ? 1 : options.programIds?.length ?? 0,
      considered: 0, extracted: 0, reused: 0, restored: 0, matched: 0,
      bodyOnly: 0, bodyOnlyFailed: 0, bodyOnlyLookupFailed: false,
      failed: 0, alreadyAttempted: 0, recoveryRefused: 0, budgetSkipped: 0, refreshPending: false, stoppedForTime: false,
      ready: 0, remaining: 0, eligible: 0, withText: 0, waitingAttachments: 0,
      requirementsExtracted: 0, requirementsFailed: 0, pendingInputChars: 0 };
    async function updateQueue() {
      const { data, error } = await admin.rpc("openchat_review_queue_status", {
        p_review_date: date, p_include_excluded: includeExcluded,
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("요건 대기 현황 조회 실패");
      const counts = data as Partial<QueueCounts>;
      for (const key of QUEUE_FIELDS) {
        const count = counts[key];
        if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) summary[key] = count;
      }
    }
    await updateQueue();
    if (!options.programIds && !options.recoveryProgramId) summary.scopeProgramCount = summary.eligible;
    let profiles, profileRevision: number;
    try {
      const snapshot = await loadMatchProfilesSnapshot(admin, { now });
      profiles = snapshot.profiles;
      profileRevision = snapshot.revision;
    }
    catch (error) {
      if (error instanceof MatchProfilesError && error.code === "refresh_pending") return { ...summary, refreshPending: true };
      if (error instanceof MatchProfilesError) throw new MatchProfilesError(error.code,
        "고객 프로필을 확인하지 못해 요건 추출·매칭을 보류했습니다.");
      throw new Error("고객 프로필을 확인하지 못해 요건 추출·매칭을 보류했습니다.");
    }
    summary.profiles = profiles.length;
    let programs: Program[];
    if (options.recoveryProgramId) {
      const { data, error } = await admin.from("openchat_programs").select("id,status,deadline_at,created_at")
        .eq("id", options.recoveryProgramId).maybeSingle();
      if (error) throw new Error("복구 대상 공고 조회 실패");
      programs = data && (includeExcluded || data.status !== "excluded")
        && Date.parse(data.created_at) >= started - 60 * 86400_000
        && (!data.deadline_at || Date.parse(data.deadline_at) >= clock()) ? [data as Program] : [];
    } else {
      const { data, error } = await admin.rpc("list_openchat_requirement_work", {
        p_review_date: date, p_limit: max, p_program_ids: options.programIds?.slice(0, 1000) ?? null,
        p_include_excluded: includeExcluded,
      }) as { data: Program[] | null; error: unknown };
      if (error) throw new Error("검토 대상 공고 조회 실패");
      programs = data ?? [];
    }
    summary.queued = programs.length;
    // ── 글만 있는 수집기 공고 (2026-11-25) ─────────────────────────────
    // 아래 보통 공고의 줄과 **따로** 돈다. 모델을 부르지 않으므로 예산이 막힌 날에도 판정되고,
    // 여기서 무엇이 실패해도 보통 공고의 판정은 그대로 이어진다 (실패는 세기만 한다).
    // 먼저 도는 까닭: 뒤에 두면 보통 공고가 시간·예산으로 멈출 때마다 같이 밀린다.
    // 새 판정을 시작하는 것은 1분까지다. 하루에 한 번 판정하면 끝이라, 다음 실행부터는 거의 할 일이 없다.
    if (!options.recoveryProgramId) {
      /** 요건은 그대로 두고 판정만 한다. 판정을 저장했으면 true. */
      const judgeBodyOnly = async (program: Program) => {
        const sourceCheckedAt = new Date(clock()).toISOString();
        const { data: attachments, error: attachmentError } = await admin.from("openchat_program_attachments")
          .select("id,text_content,text_status").eq("program_id", program.id);
        if (attachmentError) throw new Error("요건 원문 조회 실패");
        // 그새 첨부 글자가 생겼으면 보통 공고다 — 작업 줄이 세운다.
        if (attachments?.some((a) => a.text_status === "extracted" && a.text_content?.trim())) return false;
        const { data: existing, error: existingError } = await admin.from("openchat_program_requirements")
          .select("input_hash,status,requirements,normalization_version,source_complete,input_truncated,model,source_manifest")
          .eq("program_id", program.id).maybeSingle();
        if (existingError) throw new Error("요건 처리 이력 조회 실패");
        // 찾은 뒤에 요건이 바뀌었을 수 있다. 판정 직전에 다시 가린다.
        if (!existing || existing.status !== "extracted"
          || typeof existing.input_hash !== "string" || !existing.input_hash
          || existing.normalization_version !== REQUIREMENTS_NORMALIZATION_VERSION
          || !(existing.model === COLLECTOR_TAG || existing.model == null)
          || !bodyOnlyManifest(existing.source_manifest)
          || !(await collectorOwned(admin, program.id))) return false;
        // 확인 시각만 적는다. 요건은 다듬지도 덮지도 않는다.
        const { data: kept, error: keepError } = await admin.from("openchat_program_requirements").update({
          source_checked_at: sourceCheckedAt, updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", existing.input_hash).eq("status", "extracted")
          .select("program_id").maybeSingle();
        if (keepError) throw new Error("요건 원문 상태 갱신 실패");
        if (!kept) return false;            // 그 사이에 수집기가 새 요건을 보냈다. 다음 실행에서 판정한다.
        const current = await admin.from("openchat_programs").select("status,deadline_at").eq("id", program.id).maybeSingle();
        if (current.error || !current.data) throw new Error("매칭 전 공고 상태 확인 실패");
        if ((!includeExcluded && current.data.status === "excluded")
          || (current.data.deadline_at && Date.parse(current.data.deadline_at) < clock())) return false;
        // 경고 문구는 수집기가 요건을 뽑을 때의 원문 상태를 따른다.
        const matches = withCautions(
          matchProgram(existing.requirements as Requirements, profiles, { now: new Date(clock()), programDeadlineAt: current.data.deadline_at }),
          existing.source_complete !== false, existing.input_truncated === true);
        const { error: matchError } = await admin.rpc("save_openchat_program_matches", {
          p_program_id: program.id, p_review_date: date, p_input_hash: existing.input_hash, p_matches: matches,
          p_profile_revision: profileRevision,
        });
        if (matchError) throw new Error("대상별 매칭 저장 실패");
        return true;
      };
      const bodyOnlyEnd = Math.min(clock() + BODY_ONLY_BUDGET_MS, end - 120_000);
      let candidates: Program[] = [];
      try {
        candidates = await bodyOnlyCollectorWork(admin, {
          date, nowMs: clock(), profileRevision, includeExcluded,
          programIds: options.programIds?.slice(0, 1000), skip: new Set(programs.map((program) => program.id)),
        });
      } catch { summary.bodyOnlyLookupFailed = true; }
      for (const program of candidates) {
        if (summary.bodyOnly >= BODY_ONLY_LIMIT || clock() >= bodyOnlyEnd) break;
        try {
          if (await judgeBodyOnly(program)) { summary.bodyOnly++; summary.matched++; }
        } catch {
          // 그 공고만의 문제일 수 있으니 다음 공고로 넘어간다 (마감 가까운 한 건이 날마다
          // 맨 앞에서 나머지를 막지 않게). 실패가 쌓이면 그치고 보통 공고로 넘어간다.
          if (++summary.bodyOnlyFailed >= BODY_ONLY_MAX_FAILURES) break;
        }
      }
    }
    let paidCalls = 0;
    for (const program of programs) {
      if (end - clock() < 60_000) { summary.stoppedForTime = true; break; }
      const sourceCheckedAt = new Date(clock()).toISOString();
      const [{ data: discovery, error: detailError }, { data: attachments, error: attachmentError }] = await Promise.all([
        admin.from("openchat_program_attachment_discovery").select("detail_text").eq("program_id", program.id).maybeSingle(),
        admin.from("openchat_program_attachments").select("id,parent_id,text_content,sha256,file_name,file_ext,text_status,error")
          .eq("program_id", program.id).order("id"),
      ]);
      if (detailError || attachmentError) throw new Error("요건 원문 조회 실패");
      const extracted = attachments?.filter((a) => a.text_status === "extracted" && a.text_content?.trim()) ?? [];
      if (!extracted.length) continue;
      const complete = Boolean(attachments?.every((a) => a.file_ext === "zip"
        ? attachments.some((child) => child.parent_id === a.id) || (a.text_status === "skipped" && a.error === "ZIP 내 지원 문서 없음")
        : a.text_status === "extracted"));
      summary.considered++;
      const input = buildRequirementInput([
        { id: "0:detail", text: discovery?.detail_text ?? "" },
        ...extracted.map((a) => ({ id: `1:attachment:${a.id}`, text: a.text_content ?? "" })),
      ]);
      const metadata = { source_complete: complete, input_truncated: input.truncated, source_checked_at: sourceCheckedAt,
        source_manifest: input.sources.map((s) => ({ id: s.id, chars: s.text.length })) };
      const { data: existing, error: existingError } = await admin.from("openchat_program_requirements")
        .select("input_hash,status,requirements,normalization_version,source_complete,input_truncated,model")
        .eq("program_id", program.id).maybeSingle();
      if (existingError) throw new Error("요건 처리 이력 조회 실패");
      // 매칭에 넘길 값. 기본은 지금 읽은 원문 기준이고, 뽑아 둔 요건을 그대로 쓸 때(수집기 요건, 이미 뽑아 본 원문)만 바뀐다.
      let matchHash = input.inputHash, matchComplete = complete, matchTruncated = input.truncated, trusted = false;
      // 요건이 비워진 행은, 다시 부르기 전에 저장해 둔 답으로 되살릴 수 있는지 먼저 본다.
      const restorable = !options.recoveryProgramId && existing?.status === "failed"
        && existing.input_hash === input.inputHash
        ? await restorableRequirements(admin, program.id, input)
        : null;
      let requirements: Requirements;
      if (restorable) {
        // 유료 호출이 없다. 모델이 이미 준 답을 그대로 쓴다.
        const { data: restored, error: restoreError } = await admin.from("openchat_program_requirements").update({
          ...metadata, status: "extracted", requirements: restorable, error: null,
          normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
          diagnostics: { stage: "restored", code: "REQUIREMENTS_RESTORED_FROM_ARTIFACT" },
          extracted_at: new Date(clock()).toISOString(), updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "failed")
          .select("program_id").maybeSingle();
        if (restoreError || !restored) throw new Error("요건 되살리기 저장 실패");
        requirements = restorable;
        summary.restored++;
      } else if (!options.recoveryProgramId && existing?.input_hash === input.inputHash && existing.status === "extracted") {
        requirements = normalizeRequirements(existing.requirements, input);
        const { data: refreshed, error: refreshError } = await admin.from("openchat_program_requirements").update({
          ...metadata, requirements, normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
          updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "extracted")
          .select("program_id").maybeSingle();
        if (refreshError || !refreshed) throw new Error("요건 원문 상태 갱신 실패");
        summary.reused++;
      } else if (!options.recoveryProgramId && existing?.status === "extracted"
        && typeof existing.input_hash === "string" && existing.input_hash
        && existing.normalization_version === REQUIREMENTS_NORMALIZATION_VERSION
        // 요건을 **수집기가 쓴 것**일 때만이다 (받는 쪽이 model 칸에 표시를 남긴다).
        // 서버가 뽑아 둔 요건까지 믿으면, 정정공고로 원문이 바뀌어도 옛 요건으로 굳는다.
        && existing.model === COLLECTOR_TAG
        && await collectorOwned(admin, program.id)) {
        // ★ PC 수집기 공고는 **수집기가 정리해 보낸 요건을 그대로 쓴다** (2026-11-25).
        //
        // 수집기가 이미 원문을 읽고 요건을 뽑아 보낸다. 그런데 저장소에는 서버가 예전에
        // 붙인 첨부가 남아 있어(실측 238건) 여기서 다시 묶은 해시가 수집기 것과 달랐고,
        // 다를 때마다 같은 공고의 요건을 유료로 다시 뽑아 수집기 요건을 덮었다.
        // 해시를 맞추려던 시도는 6만 자 창에서 수집기 근거가 밀려 값이 비는 문제가 있었다.
        // 그래서 맞추지 않는다 — 수집기 요건이 있으면 **다시 뽑지도, 다시 다듬지도 않고**
        // 판정만 한다. 수집기가 새로 보내면 받는 쪽(worker-ingest)이 요건을 바꿔 쓴다.
        //
        // 요건이 없거나 실패로 남은 공고는 여기 오지 않는다 — 예전처럼 서버가 뽑는다.
        // 확인 시각만 적는다. 안 적으면 본문 확인 시각(24시간마다 갱신)보다 늘 옛것이라
        // 실행마다 다시 잡혀 작업 줄을 차지한다.
        const { data: kept, error: keepError } = await admin.from("openchat_program_requirements").update({
          source_checked_at: sourceCheckedAt, updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", existing.input_hash).eq("status", "extracted")
          .select("program_id").maybeSingle();
        if (keepError) throw new Error("요건 원문 상태 갱신 실패");
        // 그 사이에 수집기가 새 요건을 보냈다. 다음 실행에서 새것으로 판정한다.
        if (!kept) { summary.alreadyAttempted++; continue; }
        requirements = existing.requirements as Requirements;
        matchHash = existing.input_hash;
        trusted = true;
        // 경고 문구는 수집기가 요건을 뽑을 때의 원문 상태를 따른다 (서버 옛 첨부가 아니라).
        matchComplete = existing.source_complete !== false;
        matchTruncated = existing.input_truncated === true;
        summary.reused++;
      } else if (!options.recoveryProgramId && existing?.status === "extracted" && existing.requirements != null
        && typeof existing.input_hash === "string" && existing.input_hash
        && await attemptedBefore(admin, program.id, input.inputHash)) {
        // ★ (2026-11-26) 원문이 바뀌었지만 **그 원문으로는 이미 한 번 뽑아 본** 공고.
        //
        // 같은 원문은 두 번 부르지 않으므로 아래 claim 이 거절한다. 예전에는 거절된 뒤
        // 판정까지 건너뛰어, 상세 글이 A→B→A 로 오가는 공고 30건이 11-17~23 이후로
        // 한 번도 판정되지 않았다 (고객사 누구에게도 안 갔다). 유료 호출 없이 판정한다.
        //
        // 1) 그 원문(A)으로 모델이 준 답이 남아 있고 지금 원문으로 근거가 맞으면 그 답을 쓴다.
        //    지금 원문에 맞는 답이라, 다른 원문(B)으로 뽑은 요건보다 믿을 만하다.
        // 2) 답이 없으면(그때 호출이 실패했거나 응답이 깨졌다) 뽑아 둔 B 요건으로 판정한다.
        //    판정이 아예 없는 것보다 낫다. 이 경우는 사람이 부르는 복구로도 고칠 수 없다
        //    (복구는 실패로 남은 행만 받는다) — 원문이 다시 바뀌면 그때 새로 뽑는다.
        //
        // 수집기가 보낸 요건(model 표시)은 서버 답으로 덮지 않는다. 덮으면 표시는 수집기인데
        // 내용은 서버 답이 되어, 뒤에 수집기 가지가 그것을 수집기 요건으로 믿는다.
        const answer = existing.model === COLLECTOR_TAG ? null : await restorableRequirements(admin, program.id, input);
        if (answer) {
          const { data: restored, error: restoreError } = await admin.from("openchat_program_requirements").update({
            ...metadata, input_hash: input.inputHash, status: "extracted", requirements: answer, error: null,
            normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
            diagnostics: { stage: "restored", code: "REQUIREMENTS_RESTORED_FROM_ARTIFACT" },
            extracted_at: new Date(clock()).toISOString(), updated_at: new Date(clock()).toISOString(),
          }).eq("program_id", program.id).eq("input_hash", existing.input_hash).eq("status", "extracted")
            .select("program_id").maybeSingle();
          if (restoreError) throw new Error("요건 되살리기 저장 실패");
          // 그 사이에 다른 실행이나 수집기가 행을 바꿨다. 다음 실행에서 다시 본다.
          if (!restored) { summary.alreadyAttempted++; continue; }
          requirements = answer;
          // 저장하는 사이 수집기가 행을 바꾸면('Stale requirements') 이 한 건만 넘긴다.
          trusted = true;
          summary.restored++;
        } else {
          // 판이 옛것이면 그대로 쓰지 않는다 (같은 해시였다면 위에서 다시 다듬었을 요건이다).
          if (existing.normalization_version !== REQUIREMENTS_NORMALIZATION_VERSION) { summary.alreadyAttempted++; continue; }
          // 확인 시각만 적는다. 안 적으면 실행마다 다시 잡혀 작업 줄을 차지한다.
          const { data: kept, error: keepError } = await admin.from("openchat_program_requirements").update({
            source_checked_at: sourceCheckedAt, updated_at: new Date(clock()).toISOString(),
          }).eq("program_id", program.id).eq("input_hash", existing.input_hash).eq("status", "extracted")
            .select("program_id").maybeSingle();
          if (keepError) throw new Error("요건 원문 상태 갱신 실패");
          if (!kept) { summary.alreadyAttempted++; continue; }
          requirements = existing.requirements as Requirements;
          matchHash = existing.input_hash;
          // 저장하는 사이 행이 바뀌면('Stale requirements') 이 한 건만 넘기고 다음 실행에서 다시 본다.
          trusted = true;
          matchComplete = existing.source_complete !== false;
          matchTruncated = existing.input_truncated === true;
          summary.reused++;
        }
      } else {
        if (paidCalls >= max) break;
        if (end - clock() < 60_000) { summary.stoppedForTime = true; break; }
        let recoveryId: string | null = null;
        if (options.recoveryProgramId) {
          // 복구는 지금 읽은 원문으로 다시 뽑는 것이다 — 저장된 해시가 같은지는 따지지 않는다.
          if (existing?.status !== "failed") { summary.alreadyAttempted++; continue; }
          const { data, error } = await admin.rpc("claim_openchat_requirement_recovery", {
            p_program_id: program.id, p_input_hash: input.inputHash,
          });
          if (error) throw new Error("요건 복구 호출 잠금 실패");
          // 횟수 상한·기간에 걸려 거절된 것은 '이번엔 할 일이 없었다' 와 달리 따로 센다.
          if (typeof data !== "string" || !data) { summary.recoveryRefused++; continue; }
          recoveryId = data;
        } else if (existing?.status === "failed" && existing.input_hash === input.inputHash) {
          // 같은 원문으로 실패한 채 굳은 공고다. 자동으로 **한 번만** 다시 부른다.
          //
          // 2026-11-04 에 답변 길이 한도를 넘겨 줄줄이 실패한 공고 67건이 이렇게
          // 남았다. 스키마는 되돌렸지만, 일반 경로는 같은 원문을 두 번 부르지
          // 않아서 고쳐진 뒤에도 영영 실패로 남았다.
          //
          // 그 한 번도 실패하면 거절되고 (kind='auto' 상한 1회), 그때부터는
          // 공고 탓으로 보고 더 부르지 않는다. 사람이 부르는 복구 3회는 따로 남아 있다.
          const { data, error } = await admin.rpc("claim_openchat_requirement_auto_retry", {
            p_program_id: program.id, p_input_hash: input.inputHash,
          });
          if (error) throw new Error("요건 자동 재시도 잠금 실패");
          if (typeof data !== "string" || !data) { summary.recoveryRefused++; continue; }
          recoveryId = data;
        } else {
          const { data: claimed, error: claimError } = await admin.rpc("claim_openchat_requirement", {
            p_program_id: program.id, p_input_hash: input.inputHash,
          });
          if (claimError) throw new Error("요건 중복 호출 잠금 실패");
          if (!claimed) { summary.alreadyAttempted++; continue; }
        }
        let networkStarted = false;
        let safeDiagnostics: Record<string, unknown> = { stage: "before_call", code: "REQUIREMENTS_PENDING" };
        async function release() {
          const { error } = recoveryId
            ? await admin.rpc("release_openchat_requirement_recovery_budget", { p_recovery_id: recoveryId })
            : await admin.rpc("release_openchat_requirement_budget", { p_program_id: program.id, p_input_hash: input.inputHash });
          if (error) throw new Error("요건 호출 전 보류 저장 실패");
        }
        async function persistArtifact(responseText: string | null) {
          let update = admin.from(recoveryId ? "openchat_program_requirement_recoveries" : "openchat_program_requirement_attempts")
            .update({ response_text: responseText, diagnostics: safeDiagnostics, responded_at: new Date(clock()).toISOString() })
            .eq("program_id", program.id).eq("input_hash", input.inputHash);
          if (recoveryId) update = update.eq("id", recoveryId);
          const { data, error } = await update.select(recoveryId ? "id" : "program_id").maybeSingle();
          if (error || !data) throw new RequirementTaskFailure("REQUIREMENTS_ARTIFACT_SAVE_FAILED");
        }
        try {
          const prepared = await admin.from("openchat_program_requirements").update({
            ...metadata, model: GEMINI_AUTOMATION_MODEL, diagnostics: safeDiagnostics,
            updated_at: new Date(clock()).toISOString(),
          }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "processing")
            .select("program_id").maybeSingle();
          if (prepared.error || !prepared.data) throw new RequirementTaskFailure("REQUIREMENTS_METADATA_SAVE_FAILED");
          if (end - clock() < 60_000) throw new ReviewTimeDeferred();
          requirements = await runBudgetedGeminiAutomation({
            operation: "program-review-requirements", actor: "cron", plannedCalls: 1,
            estimatedInputTokens: Math.ceil(requirementsPrompt(input).length), estimatedOutputTokens: REQUIREMENTS_RESPONSE_MAX_TOKENS,
          }, async () => {
            const remaining = end - clock();
            if (remaining < 60_000) throw new ReviewTimeDeferred();
            paidCalls++;
            networkStarted = true;
            let result;
            try { result = await generateRequirementResponse(input, { timeoutMs: Math.min(80_000, remaining - 25_000) }); }
            catch (error) {
              safeDiagnostics = error instanceof RequirementGenerationError
                ? { ...error.safeDiagnostics, stage: "generation_failed" }
                : { stage: "generation_failed", code: "GEMINI_REQUEST_FAILED" };
              await persistArtifact(null);
              throw new RequirementTaskFailure("REQUIREMENTS_GENERATION_FAILED");
            }
            const finishCode = result.finishReason === "STOP" ? null
              : result.finishReason === "MAX_TOKENS" ? "REQUIREMENTS_MAX_TOKENS" : "REQUIREMENTS_FINISH_INCOMPLETE";
            safeDiagnostics = { ...result.safeDiagnostics, stage: finishCode ? "finish_failed" : "response_received",
              ...(finishCode ? { code: finishCode } : {}) };
            // Private artifact is durable before JSON parsing or normalization can fail.
            await persistArtifact(result.rawText);
            if (finishCode) throw new RequirementTaskFailure(finishCode);
            let parsed: unknown;
            try { parsed = parseGeminiJson<unknown>(result.rawText); }
            catch { throw new RequirementTaskFailure("REQUIREMENTS_JSON_INVALID"); }
            try { return normalizeRequirements(parsed, input); }
            catch { throw new RequirementTaskFailure("REQUIREMENTS_PROOF_INVALID"); }
          });
          const { data: saved, error: saveError } = await admin.from("openchat_program_requirements").update({
            status: "extracted", requirements, normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
            model: GEMINI_AUTOMATION_MODEL, error: null,
            diagnostics: { ...safeDiagnostics, stage: "stored" },
            extracted_at: new Date(clock()).toISOString(), updated_at: new Date(clock()).toISOString(),
          }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "processing")
            .select("program_id").maybeSingle();
          if (saveError || !saved) throw new RequirementTaskFailure("REQUIREMENTS_RESULT_SAVE_FAILED");
          summary.extracted++;
        } catch (error) {
          if (!networkStarted) {
            await release();
            if (error instanceof GeminiAutomationBlocked) { summary.budgetSkipped++; break; }
            if (error instanceof ReviewTimeDeferred) { summary.stoppedForTime = true; break; }
            throw new Error("요건 호출 전 준비 실패");
          }
          const code = error instanceof RequirementTaskFailure ? error.code : "REQUIREMENTS_GENERATION_FAILED";
          const stage = code === "REQUIREMENTS_RESULT_SAVE_FAILED" ? "result_save_failed"
            : code === "REQUIREMENTS_ARTIFACT_SAVE_FAILED" ? "artifact_save_failed"
              : code === "REQUIREMENTS_JSON_INVALID" ? "json_invalid"
                : code === "REQUIREMENTS_PROOF_INVALID" ? "proof_invalid" : safeDiagnostics.stage;
          const { error: failureError } = await admin.from("openchat_program_requirements").update({
            status: "failed", error: code, diagnostics: { ...safeDiagnostics, stage, code },
            updated_at: new Date(clock()).toISOString(),
          }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "processing");
          if (failureError) throw new Error("요건 실패 이력 저장 실패");
          if (code === "REQUIREMENTS_ARTIFACT_SAVE_FAILED") throw new Error("요건 응답 원문 저장 실패");
          summary.failed++;
          continue;
        }
      }
      const current = await admin.from("openchat_programs").select("status,deadline_at").eq("id", program.id).maybeSingle();
      if (current.error || !current.data) throw new Error("매칭 전 공고 상태 확인 실패");
      if ((!includeExcluded && current.data.status === "excluded")
        || (current.data.deadline_at && Date.parse(current.data.deadline_at) < clock())) continue;
      const matches = withCautions(
        matchProgram(requirements, profiles, { now: new Date(clock()), programDeadlineAt: current.data.deadline_at }),
        matchComplete, matchTruncated);
      const { error: matchError } = await admin.rpc("save_openchat_program_matches", {
        p_program_id: program.id, p_review_date: date, p_input_hash: matchHash, p_matches: matches,
        p_profile_revision: profileRevision,
      });
      // 수집기 요건으로 판정하는 사이에 수집기가 새 요건을 보내면 저장이 거절된다
      // (받는 쪽은 이 실행의 잠금 밖에서 돈다). 그 한 건 때문에 남은 공고까지 멈추지 않는다 —
      // 다음 실행에서 새 요건으로 다시 판정한다.
      // 그 거절('Stale requirements')만 넘긴다. 다른 오류(고객 프로필이 바뀜 등)는 예전처럼 멈춘다.
      if (matchError && trusted
        && /Stale requirements/.test(String((matchError as { message?: unknown }).message ?? ""))) {
        summary.failed++; continue;
      }
      if (matchError) throw new Error("대상별 매칭 저장 실패");
      summary.matched++;
    }
    await updateQueue();
    return summary;
  });
}
