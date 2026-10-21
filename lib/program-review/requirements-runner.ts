import { createAdminClient } from "../supabase/admin";
import { createClient } from "@supabase/supabase-js";
import { generateGeminiText } from "../gemini/client";
import { parseGeminiJson } from "../gemini/json";
import { GEMINI_AUTOMATION_MODEL, GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "../gemini/automation";
import { buildRequirementInput, normalizeRequirements, requirementsPrompt, type Requirements } from "./requirements";
import { loadMatchProfiles, MatchProfilesError } from "./profiles-run";
import { matchProgram } from "./matching";

type Admin = ReturnType<typeof createAdminClient>;
type Options = { admin?: Admin; now?: () => number; limit?: number; programIds?: string[] };
class ReviewTimeDeferred extends Error {}
function boundedAdmin(clock: () => number, end: number): Admin {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("비공개 요건 처리 설정 없음");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(Math.max(1, Math.min(20_000, end-clock()-1000))),
    ]) }) } });
}

/** Independent review work only. No writes to the existing openchat pipeline. */
export async function runRequirementsTask(options: Options = {}) {
  const clock = options.now ?? Date.now;
  const started = clock();
  const admin = options.admin ?? boundedAdmin(clock, started + 240_000);
  const now = new Date(started);
  const date = new Date(started + 9 * 3600_000).toISOString().slice(0, 10);
  const summary = { date, profiles: 0, considered: 0, extracted: 0, reused: 0, matched: 0,
    failed: 0, alreadyAttempted: 0, budgetSkipped: 0, refreshPending: false, stoppedForTime: false };
  let profiles;
  try { profiles = await loadMatchProfiles(admin, { now }); }
  catch (error) {
    if (error instanceof MatchProfilesError && error.code === "refresh_pending") {
      return { ...summary, refreshPending: true };
    }
    if (error instanceof MatchProfilesError) throw new MatchProfilesError(error.code,
      "고객 프로필을 확인하지 못해 요건 추출·매칭을 보류했습니다.");
    throw new Error("고객 프로필을 확인하지 못해 요건 추출·매칭을 보류했습니다.");
  }
  summary.profiles = profiles.length;
  const { data: programs, error } = await admin.rpc("list_openchat_requirement_work", {
    p_review_date: date, p_limit: 20, p_program_ids: options.programIds?.slice(0, 10) ?? null,
  }) as { data: Array<{ id: string; deadline_at: string | null; created_at: string }> | null; error: unknown };
  if (error) throw new Error("검토 대상 공고 조회 실패");
  const max = Math.max(1, Math.min(options.limit ?? 2, 5));
  let paidCalls = 0;
  for (const program of programs ?? []) {
    if (clock() - started > 170_000) { summary.stoppedForTime = true; break; }
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
    const { data: existing, error: existingError } = await admin.from("openchat_program_requirements")
      .select("input_hash,status,requirements").eq("program_id", program.id).maybeSingle();
    if (existingError) throw new Error("요건 처리 이력 조회 실패");
    let requirements: Requirements;
    if (existing?.input_hash === input.inputHash && existing.status === "extracted") {
      requirements = normalizeRequirements(existing.requirements, input);
      const { data: refreshed, error: refreshError } = await admin.from("openchat_program_requirements").update({
        source_complete: complete, input_truncated: input.truncated,
        source_manifest: input.sources.map((s) => ({ id: s.id, chars: s.text.length })),
        updated_at: new Date(clock()).toISOString(),
      }).eq("program_id", program.id).eq("input_hash", input.inputHash).eq("status", "extracted")
        .select("program_id").maybeSingle();
      if (refreshError || !refreshed) throw new Error("요건 원문 상태 갱신 실패");
      summary.reused++;
    } else {
      if (paidCalls >= max) break;
      if (clock() - started > 130_000) { summary.stoppedForTime = true; break; }
      const { data: claimed, error: claimError } = await admin.rpc("claim_openchat_requirement", {
        p_program_id: program.id, p_input_hash: input.inputHash,
      });
      if (claimError) throw new Error("요건 중복 호출 잠금 실패");
      if (!claimed) { summary.alreadyAttempted++; continue; }
      let networkStarted = false;
      try {
        requirements = await runBudgetedGeminiAutomation({
          operation: "program-review-requirements", actor: "cron", plannedCalls: 1,
          estimatedInputTokens: Math.ceil(requirementsPrompt(input).length), estimatedOutputTokens: 8000,
        }, async () => {
          if (clock() - started > 140_000) throw new ReviewTimeDeferred();
          paidCalls++;
          networkStarted = true;
          try {
            const result = await generateGeminiText({ model: GEMINI_AUTOMATION_MODEL,
              parts: [{ text: requirementsPrompt(input) }], attempts: 1, timeoutMs: 80_000,
              generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8000 } });
            return normalizeRequirements(parseGeminiJson<unknown>(result.text), input);
          } catch { throw new Error("공고 요건 생성 또는 근거 검증 실패"); }
        });
        const { data: saved, error: saveError } = await admin.from("openchat_program_requirements").update({
          status: "extracted", requirements, model: GEMINI_AUTOMATION_MODEL, error: null,
          source_manifest: input.sources.map((s) => ({ id: s.id, chars: s.text.length })),
          source_complete: complete, input_truncated: input.truncated,
          extracted_at: new Date(clock()).toISOString(), updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", input.inputHash).select("program_id").maybeSingle();
        if (saveError || !saved) throw new Error("요건 결과 저장 실패");
        summary.extracted++;
      } catch (error) {
        if (error instanceof GeminiAutomationBlocked || (error instanceof ReviewTimeDeferred && !networkStarted)) {
          const { error: releaseError } = await admin.rpc("release_openchat_requirement_budget", {
            p_program_id: program.id, p_input_hash: input.inputHash,
          });
          if (releaseError) throw new Error("예산 보류 이력 저장 실패");
          if (error instanceof ReviewTimeDeferred) summary.stoppedForTime = true;
          else summary.budgetSkipped++;
          break;
        }
        const { error: failureError } = await admin.from("openchat_program_requirements").update({
          status: "failed", error: "요건 생성·검증·저장 실패 (같은 원문 재호출 금지)",
          updated_at: new Date(clock()).toISOString(),
        }).eq("program_id", program.id).eq("input_hash", input.inputHash);
        if (failureError) throw new Error("요건 실패 이력 저장 실패");
        summary.failed++;
        continue;
      }
    }
    const current = await admin.from("openchat_programs").select("status,deadline_at").eq("id", program.id).maybeSingle();
    if (current.error || !current.data) throw new Error("매칭 전 공고 상태 확인 실패");
    if (current.data.status === "excluded" || (current.data.deadline_at && Date.parse(current.data.deadline_at) < clock())) continue;
    const matches = matchProgram(requirements, profiles, { now: new Date(clock()), programDeadlineAt: current.data.deadline_at }).map((m) => {
      const caution = [!complete ? "첨부 일부 미추출: 정독 확인 필요" : "", input.truncated ? "입력 6만 자 절단: 정독 확인 필요" : ""].filter(Boolean);
      return caution.length ? { ...m, verdict: "unknown" as const,
        reasons: [...m.reasons, ...caution] } : m;
    });
    const { error: matchError } = await admin.rpc("save_openchat_program_matches", {
      p_program_id: program.id, p_review_date: date, p_input_hash: input.inputHash, p_matches: matches,
    });
    if (matchError) throw new Error("대상별 매칭 저장 실패");
    summary.matched++;
  }
  return summary;
}
