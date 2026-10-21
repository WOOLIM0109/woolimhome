import { createAdminClient } from "../supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { parseGeminiJson } from "../gemini/json";
import { GEMINI_AUTOMATION_MODEL, GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "../gemini/automation";
import { buildRequirementInput, normalizeRequirements, requirementsPrompt, REQUIREMENTS_NORMALIZATION_VERSION, type Requirements } from "./requirements";
import { generateRequirementResponse, RequirementGenerationError, REQUIREMENTS_RESPONSE_MAX_TOKENS } from "./requirements-generation";
import { loadMatchProfiles, MatchProfilesError } from "./profiles-run";
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
      considered: 0, extracted: 0, reused: 0, matched: 0,
      failed: 0, alreadyAttempted: 0, budgetSkipped: 0, refreshPending: false, stoppedForTime: false,
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
    let profiles;
    try { profiles = await loadMatchProfiles(admin, { now }); }
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
        .select("input_hash,status,requirements").eq("program_id", program.id).maybeSingle();
      if (existingError) throw new Error("요건 처리 이력 조회 실패");
      let requirements: Requirements;
      if (!options.recoveryProgramId && existing?.input_hash === input.inputHash && existing.status === "extracted") {
        requirements = normalizeRequirements(existing.requirements, input);
        const { data: refreshed, error: refreshError } = await admin.from("openchat_program_requirements").update({
          ...metadata, requirements, normalization_version: REQUIREMENTS_NORMALIZATION_VERSION,
          updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "extracted")
          .select("program_id").maybeSingle();
        if (refreshError || !refreshed) throw new Error("요건 원문 상태 갱신 실패");
        summary.reused++;
      } else {
        if (paidCalls >= max) break;
        if (end - clock() < 60_000) { summary.stoppedForTime = true; break; }
        let recoveryId: string | null = null;
        if (options.recoveryProgramId) {
          if (existing?.input_hash !== input.inputHash || existing.status !== "failed") { summary.alreadyAttempted++; continue; }
          const { data, error } = await admin.rpc("claim_openchat_requirement_recovery", {
            p_program_id: program.id, p_input_hash: input.inputHash,
          });
          if (error) throw new Error("요건 복구 호출 잠금 실패");
          if (typeof data !== "string" || !data) { summary.alreadyAttempted++; continue; }
          recoveryId = data;
        } else {
          if (existing?.input_hash === input.inputHash && existing.status === "failed") { summary.alreadyAttempted++; continue; }
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
      const matches = matchProgram(requirements, profiles, { now: new Date(clock()), programDeadlineAt: current.data.deadline_at }).map((m) => {
        const caution = [!complete ? "첨부 일부 미추출: 확인 필요" : "", input.truncated ? "입력 6만 자 절단: 확인 필요" : ""].filter(Boolean);
        return caution.length ? { ...m, verdict: "unknown" as const, reasons: [...m.reasons, ...caution] } : m;
      });
      const { error: matchError } = await admin.rpc("save_openchat_program_matches", {
        p_program_id: program.id, p_review_date: date, p_input_hash: input.inputHash, p_matches: matches,
      });
      if (matchError) throw new Error("대상별 매칭 저장 실패");
      summary.matched++;
    }
    await updateQueue();
    return summary;
  });
}
