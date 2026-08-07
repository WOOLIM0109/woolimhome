import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeProgramDeterministically, analyzePrograms, generateAfternoonContent } from "./ai";
import { collectSource, hydratePrograms } from "./collectors";
import { MORNING_PROGRAM_LIMIT } from "./config";
import { sendOpenchatNotification } from "./push";
import type { CollectedProgram, OpenchatCronTask, OpenchatSource } from "./types";
import { kstDate, kstWeekday, normalizeText, programDetailIssue, programFingerprint, programTitleKey } from "./utils";

async function createRun(task: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("openchat_run_logs")
    .insert({ task, status: "running" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function finishRun(id: string, status: "completed" | "failed" | "skipped", summary: Record<string, unknown>, error?: string) {
  const admin = createAdminClient();
  await admin.from("openchat_run_logs").update({
    status,
    summary,
    error: error || null,
    finished_at: new Date().toISOString(),
  }).eq("id", id);
}

export async function isMorningBusinessDay(date = kstDate()) {
  const weekday = kstWeekday(new Date(`${date}T12:00:00+09:00`));
  if (weekday === 0 || weekday === 6) return false;
  const { data } = await createAdminClient().from("openchat_holidays")
    .select("holiday_date")
    .eq("holiday_date", date)
    .maybeSingle();
  return !data;
}

export async function nextBusinessDay(date: string) {
  const cursor = new Date(`${date}T12:00:00+09:00`);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidate = kstDate(cursor);
    if (await isMorningBusinessDay(candidate)) return candidate;
  }
  throw new Error("다음 영업일을 계산하지 못했습니다.");
}

function uniqueCandidates(programs: Array<CollectedProgram & { sourcePriority: number }>) {
  const seenTitles = new Set<string>();
  return programs
    .sort((left, right) => left.sourcePriority - right.sourcePriority)
    .filter((program) => {
      const title = programTitleKey(program.title);
      if (!title || seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    });
}

function inferSourceKey(sourceUrl: string, relationKey?: string | null) {
  if (/k-startup\.go\.kr/i.test(sourceUrl)) return "kstartup";
  if (/bizinfo\.go\.kr/i.test(sourceUrl)) return "bizinfo";
  if (/busanstartup\.kr/i.test(sourceUrl)) return "busanstartup";
  if (/fanfandaero\.kr/i.test(sourceUrl)) return "fanfandaero";
  return relationKey || "unknown";
}

async function repairIncompleteMorningPrograms(date: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("openchat_programs")
    .select("*, source:openchat_sources(source_key)")
    .eq("draft_for", date)
    .in("status", ["collected", "review_required", "approved", "deferred", "excluded", "ready"])
    .order("priority")
    .limit(100);
  if (error) throw new Error(error.message);

  const incomplete = (data || [])
    .filter((row) => programDetailIssue({
      applicantSummary: row.applicant_summary,
      supportSummary: row.support_summary,
      applicationMethod: row.application_method,
      applicationPeriodText: row.application_period_text,
      startsAt: row.starts_at,
      deadlineAt: row.deadline_at,
    }))
    .sort((left, right) => Number(!/k-startup\.go\.kr/i.test(left.source_url)) - Number(!/k-startup\.go\.kr/i.test(right.source_url)))
    .slice(0, MORNING_PROGRAM_LIMIT);
  if (!incomplete.length) return { attempted: 0, repaired: 0, stillIncomplete: 0, excluded: 0 };

  const candidates: CollectedProgram[] = incomplete.map((row) => {
    const relation = Array.isArray(row.source) ? row.source[0] : row.source;
    return {
      sourceKey: inferSourceKey(row.source_url, relation?.source_key),
      externalId: row.external_id,
      title: normalizeText(row.title).replace(/\s*새로운\s*게시글\s*$/i, "").trim(),
      url: row.source_url,
      sourcePayload: row.raw_payload || {},
    };
  });
  const hydrated = await hydratePrograms(candidates, MORNING_PROGRAM_LIMIT);
  const detailFetchFailures = hydrated.flatMap((program) => {
    const directError = program.sourcePayload?.detailFetchError;
    const readerError = program.sourcePayload?.detailReaderError;
    const message = typeof directError === "string" ? directError : typeof readerError === "string" ? readerError : null;
    return message ? [{ title: program.title, error: message }] : [];
  });
  const sourceKeys = [...new Set(hydrated.map((program) => program.sourceKey))];
  const structured = hydrated.filter((program) => (
    program.applicantSummary && program.supportSummary && program.applicationMethod
    && (program.applicationPeriodText || program.deadlineAt)
  )).length;
  const analyzed = new Array<ReturnType<typeof analyzeProgramDeterministically> | undefined>(hydrated.length);
  const aiCandidates: CollectedProgram[] = [];
  const aiIndexes: number[] = [];
  hydrated.forEach((program, index) => {
    if (program.sourceKey === "kstartup") {
      analyzed[index] = analyzeProgramDeterministically(program);
    } else {
      aiCandidates.push(program);
      aiIndexes.push(index);
    }
  });
  if (aiCandidates.length) {
    const aiResults = await analyzePrograms(aiCandidates);
    aiResults.forEach((program, index) => {
      analyzed[aiIndexes[index]] = program;
    });
  }
  let repaired = 0;
  let stillIncomplete = 0;
  let excluded = 0;

  for (let index = 0; index < incomplete.length; index += 1) {
    const existing = incomplete[index];
    const program = analyzed[index];
    if (!program) {
      stillIncomplete += 1;
      continue;
    }
    const detailIssue = programDetailIssue({
      applicantSummary: program.applicantSummary,
      supportSummary: program.supportSummary,
      applicationMethod: program.applicationMethod,
      applicationPeriodText: program.applicationPeriodText,
      startsAt: program.startsAt,
      deadlineAt: program.deadlineAt,
    });
    const deadlineValue = program.deadlineAt ? new Date(program.deadlineAt).valueOf() : null;
    const expired = deadlineValue !== null && !Number.isNaN(deadlineValue) && deadlineValue < Date.now();
    const keep = program.keep && !detailIssue && !expired;
    const restoredStatus = existing.status === "excluded" ? "review_required" : existing.status;
    const nextStatus = keep ? restoredStatus : "excluded";
    const exclusionReason = keep
      ? null
      : expired
        ? "접수 마감"
        : detailIssue
          ? `상세정보 수집 미완료: ${detailIssue}`
          : program.exclusionReason || "게시 기준 제외";
    const { error: updateError } = await admin.from("openchat_programs").update({
      title: program.title,
      applicant_summary: program.applicantSummary,
      support_summary: program.supportSummary,
      application_method: program.applicationMethod,
      application_period_text: program.applicationPeriodText,
      starts_at: program.startsAt || null,
      deadline_at: program.deadlineAt || null,
      regions: program.regions,
      categories: program.categories,
      priority: program.priority,
      status: nextStatus,
      exclusion_reason: exclusionReason,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
    if (keep) repaired += 1;
    else if (detailIssue) stillIncomplete += 1;
    else excluded += 1;
  }
  return { attempted: incomplete.length, repaired, stillIncomplete, excluded, detailFetchFailures, sourceKeys, structured };
}

async function collectMorningPrograms(date: string) {
  const admin = createAdminClient();
  const { error: carryError } = await admin.from("openchat_programs")
    .update({ status: "review_required", updated_at: new Date().toISOString() })
    .eq("draft_for", date)
    .eq("status", "deferred");
  if (carryError) throw new Error(carryError.message);
  const repair = await repairIncompleteMorningPrograms(date);
  const { data: sourceRows, error: sourceError } = await admin.from("openchat_sources")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (sourceError) throw new Error(sourceError.message);
  const sources = (sourceRows || []) as OpenchatSource[];
  const collected: Array<CollectedProgram & { sourcePriority: number }> = [];
  const failures: Array<{ source: string; error: string }> = [];

  for (let index = 0; index < sources.length; index += 4) {
    const batch = sources.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map(async (source) => {
      const items = await collectSource(source);
      await admin.from("openchat_sources").update({
        last_checked_at: new Date().toISOString(),
        last_succeeded_at: new Date().toISOString(),
        last_status: "success",
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", source.id);
      return { source, items };
    }));
    for (let offset = 0; offset < results.length; offset += 1) {
      const result = results[offset];
      const source = batch[offset];
      if (result.status === "fulfilled") {
        collected.push(...result.value.items.map((item) => ({ ...item, sourcePriority: source.priority })));
      } else {
        const message = result.reason instanceof Error ? result.reason.message : "수집 실패";
        failures.push({ source: source.name, error: message });
        await admin.from("openchat_sources").update({
          last_checked_at: new Date().toISOString(),
          last_status: "failed",
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq("id", source.id);
      }
    }
  }

  const candidates = uniqueCandidates(collected);
  const withFingerprints = candidates.map((program) => ({
    ...program,
    fingerprint: programFingerprint(
      program.title,
      program.url,
      program.externalId ? `${program.sourceKey}:${program.externalId}` : null,
    ),
  }));
  const fingerprints = withFingerprints.map((program) => program.fingerprint);
  const existing = new Set<string>();
  for (let index = 0; index < fingerprints.length; index += 100) {
    const { data, error } = await admin.from("openchat_programs")
      .select("fingerprint")
      .in("fingerprint", fingerprints.slice(index, index + 100));
    if (error) throw new Error(error.message);
    for (const row of data || []) existing.add(row.fingerprint);
  }
  const { data: recentTitles, error: titleError } = await admin.from("openchat_programs")
    .select("title")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (titleError) throw new Error(titleError.message);
  const existingTitles = new Set((recentTitles || []).map((row) => programTitleKey(row.title)));
  const fresh = withFingerprints.filter((program) => (
    !existing.has(program.fingerprint) && !existingTitles.has(programTitleKey(program.title))
  )).slice(0, 30);
  if (!fresh.length) return { collected: collected.length, newPrograms: 0, repair, failures };

  const hydrated = await hydratePrograms(fresh, 30);
  const analysis = await analyzePrograms(hydrated);
  const sourceByKey = new Map(sources.map((source) => [source.source_key, source]));
  const now = Date.now();
  const rows = analysis.map((program) => {
    const original = fresh.find((item) => item.sourceKey === program.sourceKey
      && (item.externalId || item.url) === (program.externalId || program.url));
    const deadlineValue = program.deadlineAt ? new Date(program.deadlineAt).valueOf() : null;
    const expired = deadlineValue !== null && !Number.isNaN(deadlineValue) && deadlineValue < now;
    const detailIssue = programDetailIssue({
      applicantSummary: program.applicantSummary,
      supportSummary: program.supportSummary,
      applicationMethod: program.applicationMethod,
      applicationPeriodText: program.applicationPeriodText,
      startsAt: program.startsAt,
      deadlineAt: program.deadlineAt,
    });
    const keep = program.keep && !expired && !detailIssue;
    return {
      source_id: sourceByKey.get(program.sourceKey)?.id || null,
      external_id: program.externalId || null,
      fingerprint: original?.fingerprint || programFingerprint(program.title, program.url),
      title: program.title,
      applicant_summary: program.applicantSummary,
      support_summary: program.supportSummary,
      application_method: program.applicationMethod,
      application_period_text: program.applicationPeriodText,
      source_url: program.url,
      starts_at: program.startsAt || null,
      deadline_at: program.deadlineAt || null,
      regions: program.regions,
      categories: program.categories,
      status: keep ? "review_required" : "excluded",
      priority: program.priority,
      draft_for: keep || detailIssue ? date : null,
      exclusion_reason: keep ? null : (expired ? "접수 마감" : detailIssue ? `상세정보 수집 미완료: ${detailIssue}` : program.exclusionReason || "게시 기준 제외"),
      raw_payload: original?.sourcePayload || {},
      updated_at: new Date().toISOString(),
    };
  });
  const { error: insertError } = await admin.from("openchat_programs")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (insertError) throw new Error(insertError.message);
  return {
    collected: collected.length,
    newPrograms: rows.filter((row) => row.status === "review_required").length,
    excluded: rows.filter((row) => row.status === "excluded").length,
    incomplete: rows.filter((row) => row.exclusion_reason?.startsWith("상세정보 수집 미완료")).length,
    repair,
    failures,
  };
}

async function finalizeMorningCutoff(date: string) {
  const admin = createAdminClient();
  const carryDate = await nextBusinessDay(date);
  const { data, error } = await admin.from("openchat_programs")
    .update({ status: "deferred", draft_for: carryDate, updated_at: new Date().toISOString() })
    .eq("draft_for", date)
    .in("status", ["collected", "review_required"])
    .select("id");
  if (error) throw new Error(error.message);
  return { deferred: data?.length || 0, carryDate };
}

async function makeMorningReady(date: string) {
  const admin = createAdminClient();
  const { data: approved, error: approvedError } = await admin.from("openchat_programs")
    .select("id")
    .eq("draft_for", date)
    .eq("status", "approved")
    .order("priority")
    .order("deadline_at")
    .limit(MORNING_PROGRAM_LIMIT);
  if (approvedError) throw new Error(approvedError.message);
  const ids = (approved || []).map((row) => row.id);
  if (ids.length) {
    const { error } = await admin.from("openchat_programs").update({
      status: "ready",
      ready_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).in("id", ids);
    if (error) throw new Error(error.message);
  }
  return { ready: ids.length };
}

async function generateAfternoonDraft(date: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("openchat_content_drafts")
    .select("id,status")
    .eq("content_date", date)
    .maybeSingle();
  if (existing) return { created: false, existing };
  const lookback = new Date(`${date}T12:00:00+09:00`);
  lookback.setUTCDate(lookback.getUTCDate() - 365);
  const { data: history, error } = await admin.from("openchat_content_history")
    .select("id,published_on,title,summary,keywords")
    .gte("published_on", kstDate(lookback))
    .order("published_on", { ascending: false });
  if (error) throw new Error(error.message);
  const generated = await generateAfternoonContent({
    date,
    weekday: kstWeekday(new Date(`${date}T12:00:00+09:00`)),
    history: history || [],
  });
  const status = generated.similarity.duplicate ? "on_hold" : "review_required";
  const { data, error: insertError } = await admin.from("openchat_content_drafts").insert({
    content_date: date,
    weekday_theme: generated.theme,
    title: generated.title,
    body: generated.body,
    reference_urls: generated.referenceUrls,
    keywords: generated.keywords,
    similarity_score: generated.similarity.score,
    similar_history_ids: generated.similarity.matches.map((match) => match.id),
    status,
    review_note: status === "on_hold"
      ? `과거 콘텐츠와 중복 위험 ${generated.similarity.score}점: ${generated.similarity.matches[0]?.title || "유사 주제"}`
      : null,
    metadata: {
      generationReason: generated.reason,
      similarityMatches: generated.similarity.matches,
      generatedAt: new Date().toISOString(),
    },
  }).select().single();
  if (insertError) throw new Error(insertError.message);
  return { created: true, draft: data };
}

async function finalizeAfternoonCutoff(date: string) {
  const { data, error } = await createAdminClient().from("openchat_content_drafts")
    .update({ status: "deferred", updated_at: new Date().toISOString() })
    .eq("content_date", date)
    .in("status", ["topic_candidate", "review_required", "on_hold"])
    .select("id");
  if (error) throw new Error(error.message);
  return { deferred: data?.length || 0 };
}

async function makeAfternoonReady(date: string) {
  const { data, error } = await createAdminClient().from("openchat_content_drafts")
    .update({ status: "ready", ready_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("content_date", date)
    .eq("status", "approved")
    .select("id");
  if (error) throw new Error(error.message);
  return { ready: data?.length || 0 };
}

export async function executeOpenchatTask(task: OpenchatCronTask, requestedDate?: string) {
  const date = requestedDate || kstDate();
  const runId = await createRun(task);
  try {
    const morningTask = task.startsWith("morning-");
    if (morningTask && !(await isMorningBusinessDay(date))) {
      const summary = { date, reason: "주말 또는 공휴일" };
      await finishRun(runId, "skipped", summary);
      return { task, status: "skipped", ...summary };
    }
    let summary: Record<string, unknown>;
    switch (task) {
      case "morning-repair":
        summary = await repairIncompleteMorningPrograms(date);
        break;
      case "morning-collect":
        summary = await collectMorningPrograms(date);
        break;
      case "morning-draft-notify": {
        const { count, error } = await createAdminClient().from("openchat_programs")
          .select("id", { count: "exact", head: true })
          .eq("draft_for", date)
          .eq("status", "review_required");
        if (error) throw new Error(error.message);
        summary = { reviewRequired: count || 0 };
        break;
      }
      case "morning-approval-reminder": {
        const { count, error } = await createAdminClient().from("openchat_programs")
          .select("id", { count: "exact", head: true })
          .eq("draft_for", date)
          .eq("status", "review_required");
        if (error) throw new Error(error.message);
        summary = { reviewRequired: count || 0, cutoffAt: "10:15" };
        break;
      }
      case "morning-cutoff":
        summary = await finalizeMorningCutoff(date);
        break;
      case "morning-ready":
        summary = await makeMorningReady(date);
        break;
      case "afternoon-draft":
        summary = await generateAfternoonDraft(date);
        break;
      case "afternoon-cutoff":
        summary = await finalizeAfternoonCutoff(date);
        break;
      case "afternoon-ready":
        summary = await makeAfternoonReady(date);
        break;
      default:
        throw new Error(`지원하지 않는 작업: ${String(task)}`);
    }
    const push = await sendOpenchatNotification(task, summary);
    summary = { ...summary, push };
    await finishRun(runId, "completed", { date, ...summary });
    return { task, status: "completed", date, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "작업 실패";
    await finishRun(runId, "failed", { date }, message);
    throw error;
  }
}
