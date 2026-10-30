import type { SupabaseClient } from "@supabase/supabase-js";
import { ProgramApiError } from "./agent-auth.ts";
import { entityTargetName } from "./customer-profiles.ts";
import { boundedText, profileKey, readApprovedSelfProfiles, strictKeys, stringList, validateProfilePatch } from "./profiles-store.ts";
import { matchVerdictLabel } from "./matching.ts";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PROGRAM_KEYS = "id,title,source_id,source_url,applicant_summary,support_summary,application_method,application_period_text,starts_at,deadline_at,regions,categories,status,created_at,updated_at".split(",");
// `raw_payload` 는 **읽기만** 합니다. 그대로 내보내지 않고 아래에서 표시 하나만 뽑습니다
// (수집기가 담아 둔 원자료가 통째로 밖으로 나가면 안 됩니다).
const PROGRAM_COLUMNS: string = `${PROGRAM_KEYS.join(",")},raw_payload,source:openchat_sources(name,source_key,category)`;
const MATCH_COLUMNS = "program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date,selected_for_reading";
const REQUIREMENT_COLUMNS = "status,requirements,source_complete,input_truncated,extracted_at,normalization_version,source_checked_at,updated_at,matched_normalization_version,matched_review_date,matched_source_checked_at,matched_profile_revision,matched_rule_version";
const ATTACHMENT_COLUMNS = "id,file_name,file_ext,text_status,text_chars,extracted_at";
const STATUSES = ["collected", "review_required", "approved", "deferred", "excluded", "ready", "published"];

export function requireUuid(value: string) { if (!UUID.test(value)) throw new ProgramApiError(400, "INVALID_ID"); return value; }
function dateKst(now: Date) { return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function checked<T>(response: { data: T | null; error: unknown }): T | null {
  if (response.error) throw new ProgramApiError(503, "DATA_UNAVAILABLE"); return response.data;
}
async function allRows(fetchPage: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const rows: Row[] = [];
  for (let page = 0; page < 20; page++) {
    const batch = checked(await fetchPage(page * 500, page * 500 + 499)) ?? [];
    rows.push(...batch); if (batch.length < 500) return rows;
  }
  throw new ProgramApiError(503, "RESULT_SET_TOO_LARGE");
}
function pick(row: Row, keys: readonly string[]) { return Object.fromEntries(keys.map(key => [key, row[key] ?? null])); }
function publicSource(value: unknown) {
  try {
    const url = new URL(String(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/token|key|secret|auth|signature|password|credential|session/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; }
}
function programDto(row: Row) {
  const source = object(row.source);
  const collected = object(row.raw_payload);
  return { ...pick(row, PROGRAM_KEYS), source_url: publicSource(row.source_url),
    // 교육·행사로 보인다는 표시. 화면에서 뒤로 밀 때 씁니다 — 거르지 않습니다.
    event_like: collected?.event_like === true,
    source: source ? pick(source, ["name", "source_key", "category"]) : null };
}
function attachmentDto(row: Row) { return pick(row, ATTACHMENT_COLUMNS.split(",")); }
function matchDto(row: Row) {
  const reasons = Array.isArray(row.reasons) ? row.reasons.filter((value): value is string => typeof value === "string") : [];
  const verdict = row.verdict === "candidate" || row.verdict === "mismatch" ? row.verdict : "unknown";
  return { target_kind: row.target_kind, target_id: row.target_id, target_name: row.target_name, verdict,
    verdict_label: matchVerdictLabel({ verdict, reasons }), reasons, score: Number(row.score),
    review_date: row.review_date, selected_for_reading: row.selected_for_reading === true };
}
function strings(value: unknown) { return Array.isArray(value) ? value.filter(v => typeof v === "string") : null; }
function object(value: unknown): Row | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }
/** Canonical fields only: no provider result, diagnostics, cache payload or storage object can escape. */
export function requirementsDto(value: unknown) {
  const row = object(value); if (!row) return null;
  const result: Row = {};
  for (const key of ["regions", "target_types", "industries_included", "industries_excluded", "required_certifications"]) result[key] = strings(row[key]);
  for (const key of ["support_amount_text", "self_pay_text", "deadline_at", "contact"]) result[key] = typeof row[key] === "string" ? row[key] : null;
  for (const [key, keys] of Object.entries({ business_age: ["min_years", "max_years", "basis", "as_of"],
    size: ["max_employees", "max_revenue_krw", "text"], evaluation: ["method", "criteria_text"] })) {
    const nested = object(row[key]); result[key] = nested ? Object.fromEntries(keys.map(field => [field,
      ["min_years", "max_years", "max_employees", "max_revenue_krw"].includes(field)
        ? typeof nested[field] === "number" && Number.isFinite(nested[field]) ? nested[field] : null
        : typeof nested[field] === "string" ? nested[field] : null])) : null;
  }
  for (const [key, keys] of Object.entries({ bonus_points: ["item", "points"], submission_documents: ["name", "issuer", "note"] })) {
    result[key] = Array.isArray(row[key]) ? (row[key] as unknown[]).map(item => object(item)).filter((item): item is Row => Boolean(item))
      .map(item => Object.fromEntries(keys.map(field => [field, field === "points"
        ? typeof item[field] === "number" && Number.isFinite(item[field]) ? item[field] : null
        : typeof item[field] === "string" ? item[field] : null]))) : null;
  }
  const evidence = object(row.evidence);
  result.evidence = evidence ? Object.fromEntries(Object.entries(evidence).filter(([key, item]) => {
    if (!/^[a-z_]+(?:\.[a-z_0-9]+)*$/.test(key) || typeof item !== "string") return false;
    let value: unknown = result;
    for (const field of key.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, field)) return false;
      value = (value as Row)[field];
    }
    return typeof value === "number" || typeof value === "string" || typeof value === "boolean";
  })) : null;
  return result;
}

export class ProgramAgentService {
  constructor(private readonly admin: SupabaseClient, private readonly now = new Date()) {}
  private get since() { return new Date(this.now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); }
  private get date() { return dateKst(this.now); }
  private async contextRevision() {
    const row = checked(await this.admin.from("openchat_program_match_context").select("revision").eq("id", "current").single()) as Row | null;
    if (!row) throw new ProgramApiError(503, "MATCH_CONTEXT_UNAVAILABLE"); return String(row.revision);
  }
  private async program(id: string) {
    requireUuid(id);
    const row = checked(await this.admin.from("openchat_programs").select(PROGRAM_COLUMNS).eq("id", id).gte("created_at", this.since).maybeSingle());
    if (!row) throw new ProgramApiError(404, "PROGRAM_NOT_FOUND"); return row as Row;
  }
  private matches(ids: string[]) {
    if (!ids.length) return Promise.resolve([] as Row[]);
    return allRows((start, end) => this.admin.from("openchat_program_matches").select(MATCH_COLUMNS).in("program_id", ids)
      .eq("review_date", this.date).order("program_id").order("target_kind").order("target_id").range(start, end).abortSignal(AbortSignal.timeout(15_000)));
  }
  private async requirement(id: string) {
    return checked(await this.admin.from("openchat_program_requirements").select(REQUIREMENT_COLUMNS).eq("program_id", id).maybeSingle()) as Row | null;
  }
  private isStale(row: Row | null, revision: string) {
    return !row || row.status !== "extracted" || row.matched_normalization_version !== row.normalization_version
      || row.matched_review_date !== this.date || row.matched_source_checked_at !== row.source_checked_at
      || String(row.matched_profile_revision) !== revision || Number(row.matched_rule_version) < 2;
  }
  private async matchesStale(id: string, row: Row | null, revision: string) {
    if (this.isStale(row, revision)) return true;
    const [discovery, attachments] = await Promise.all([
      this.admin.from("openchat_program_attachment_discovery").select("checked_at").eq("program_id", id).maybeSingle(),
      allRows((start, end) => this.admin.from("openchat_program_attachments").select("created_at,extracted_at,processing_started_at")
        .eq("program_id", id).order("id").range(start, end)),
    ]);
    const current = checked(discovery) as Row | null;
    const canonical = Date.parse(String(row!.source_checked_at ?? row!.updated_at));
    const touched = [current?.checked_at, ...attachments.flatMap(a => [a.created_at, a.extracted_at, a.processing_started_at])]
      .map(value => Date.parse(String(value))).filter(Number.isFinite);
    return !Number.isFinite(canonical) || touched.some(value => value > canonical);
  }
  async today() {
    const selected = await allRows((start, end) => this.admin.from("openchat_program_matches").select("program_id")
      .eq("review_date", this.date).eq("selected_for_reading", true).order("program_id").range(start, end).abortSignal(AbortSignal.timeout(15_000)));
    const ids = [...new Set(selected.map(row => String(row.program_id)))];
    if (!ids.length) return { review_date: this.date, programs: [] };
    const programs = checked(await this.admin.from("openchat_programs").select(PROGRAM_COLUMNS).in("id", ids)
      .gte("created_at", this.since).neq("status", "excluded").or(`deadline_at.is.null,deadline_at.gte.${this.now.toISOString()}`)
      .overrideTypes<Row[], { merge: false }>()) ?? [];
    const matches = await this.matches(programs.map(row => String(row.id))), revision = await this.contextRevision();
    // 교육·행사로 보이는 공고는 **뒤로 민다.** 거르지는 않는다 — 돈을 주는 공고가
    // 잘못 걸릴 수 있어서, 하루 8칸 안에서 순서만 양보시킨다.
    const ranked = programs.map(row => ({ row,
      event: object(row.raw_payload)?.event_like === true,
      score: Math.max(...matches.filter(m => m.program_id === row.id && m.verdict !== "mismatch").map(m => Number(m.score))) }))
      .sort((a, b) => Number(a.event) - Number(b.event) || b.score - a.score
        || String(a.row.id).localeCompare(String(b.row.id))).slice(0, 8);
    return { review_date: this.date, programs: await Promise.all(ranked.map(async ({ row }) => ({
      ...programDto(row), matches_stale: await this.matchesStale(String(row.id), await this.requirement(String(row.id)), revision),
      matching_summary: Object.fromEntries(["candidate", "unknown", "mismatch"].map(verdict =>
        [verdict, matches.filter(m => m.program_id === row.id && m.verdict === verdict).length])),
      matches: matches.filter(m => m.program_id === row.id).map(matchDto).map(match => pick(match,
        ["target_kind", "target_id", "target_name", "verdict", "verdict_label", "score", "review_date", "selected_for_reading"])),
    }))) };
  }
  async detail(id: string) {
    const program = await this.program(id);
    const [requirement, matches, attachments, revision] = await Promise.all([this.requirement(id), this.matches([id]),
      allRows((start, end) => this.admin.from("openchat_program_attachments").select(ATTACHMENT_COLUMNS).eq("program_id", id).order("id").range(start, end)), this.contextRevision()]);
    return { program: programDto(program), requirements: requirement?.status === "extracted" ? requirementsDto(requirement.requirements) : null,
      extraction: requirement ? pick(requirement, ["status", "source_complete", "input_truncated", "extracted_at", "normalization_version"]) : null,
      matches_stale: await this.matchesStale(id, requirement, revision), matches: matches.map(matchDto), attachments: attachments.map(attachmentDto) };
  }
  async text(id: string, attachmentId?: string) {
    await this.program(id); if (attachmentId) requireUuid(attachmentId);
    const attachments = await allRows((start, end) => {
      let query = this.admin.from("openchat_program_attachments").select(`${ATTACHMENT_COLUMNS},text_content`).eq("program_id", id);
      if (attachmentId) query = query.eq("id", attachmentId);
      return query.order("id").range(start, end).abortSignal(AbortSignal.timeout(15_000));
    });
    if (attachmentId && !attachments.length) throw new ProgramApiError(404, "ATTACHMENT_NOT_FOUND");
    const discovery = attachmentId ? null : checked(await this.admin.from("openchat_program_attachment_discovery").select("detail_text").eq("program_id", id).maybeSingle()) as Row | null;
    return { program_id: id, detail_text: attachmentId ? null : discovery?.detail_text ?? "", attachments: attachments.map(row => ({
      ...attachmentDto(row), text_content: row.text_status === "extracted" && typeof row.text_content === "string" ? row.text_content : null,
    })) };
  }
  async profiles() { return { profiles: await readApprovedSelfProfiles(this.admin) }; }
  private async target(kind: unknown, id: unknown) {
    if ((kind !== "self" && kind !== "customer") || typeof id !== "string" || !id || id.length > 160) throw new ProgramApiError(400, "INVALID_TARGET");
    if (kind === "self") {
      profileKey(id); const rows = await readApprovedSelfProfiles(this.admin), row = rows.find(profile => profile.id === id);
      if (!row) throw new ProgramApiError(404, "TARGET_NOT_FOUND"); return { kind, id, name: row.name };
    }
    const row = checked(await this.admin.from("openchat_match_profiles_cache").select("payload").not("fetched_at", "is", null)
      .gt("expires_at", this.now.toISOString()).order("fetched_at", { ascending: false }).limit(1).maybeSingle()) as Row | null;
    // 판정 단위가 사업자라 대상 이름은 `고객id:사업자` 모양일 수 있습니다.
    const divider = id.indexOf(":");
    const customerId = divider < 0 ? id : id.slice(0, divider);
    const entityKey = divider < 0 ? "" : id.slice(divider + 1);
    const target = Array.isArray(row?.payload) ? (row.payload as Row[]).find(item => item.id === customerId) : null;
    if (!target || typeof target.name !== "string") throw new ProgramApiError(404, "TARGET_NOT_FOUND");
    if (!entityKey) return { kind, id, name: target.name as string };
    const entities = checked(await this.admin.from("openchat_program_customer_profiles")
      .select("entity_key,entity_name").eq("customer_id", customerId).eq("active", true)) as Row[] | null ?? [];
    const entity = entities.find(item => item.entity_key === entityKey);
    if (!entity) throw new ProgramApiError(404, "TARGET_NOT_FOUND");
    return { kind, id,
      name: entityTargetName(String(target.name), String(entity.entity_name), entities.length > 1) };
  }
  async searchPrograms(params: URLSearchParams) {
    const allowed = ["status", "since", "q", "limit", "offset", "target_kind", "target_id", "eligible"];
    if ([...params.keys()].some(key => !allowed.includes(key)) || [...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) throw new ProgramApiError(400, "INVALID_QUERY");
    const status = params.get("status"), q = params.get("q") ?? "", sinceValue = params.get("since");
    if (status && !STATUSES.includes(status)) throw new ProgramApiError(400, "INVALID_STATUS");
    if (q.length > 200 || q.includes("\u0000")) throw new ProgramApiError(400, "INVALID_QUERY");
    let since = this.since;
    if (sinceValue) {
      const time = Date.parse(sinceValue);
      if (!/^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?$/.test(sinceValue) || !Number.isFinite(time)
        || new Date(time).toISOString().slice(0, 10) !== sinceValue.slice(0, 10) || time > this.now.getTime()) throw new ProgramApiError(400, "INVALID_SINCE");
      since = new Date(Math.max(time, Date.parse(this.since))).toISOString();
    }
    const number = (key: string, fallback: number, maximum: number) => {
      const value = params.get(key); if (value !== null && (!/^\d+$/.test(value) || Number(value) > maximum)) throw new ProgramApiError(400, "INVALID_QUERY");
      return value === null ? fallback : Number(value);
    };
    const limit = number("limit", 50, 100), offset = number("offset", 0, 5000);
    if (limit < 1 || (params.has("eligible") && !["true", "false"].includes(params.get("eligible")!))) throw new ProgramApiError(400, "INVALID_QUERY");
    const targetKind = params.get("target_kind"), targetId = params.get("target_id");
    let targetMatches: Row[] | null = null;
    if (targetKind || targetId) {
      const target = await this.target(targetKind, targetId);
      targetMatches = await allRows((start, end) => this.admin.from("openchat_program_matches").select(MATCH_COLUMNS)
        .eq("review_date", this.date).eq("target_kind", target.kind).eq("target_id", target.id).in("verdict", ["candidate", "unknown"])
        .order("verdict").order("score", { ascending: false }).order("program_id").range(start, end));
      if (!targetMatches.length) return { programs: [], limit, offset, has_more: false };
    }
    const query = (targetProgramIds?: string[]) => {
      let query = this.admin.from("openchat_programs").select(PROGRAM_COLUMNS).gte("created_at", since);
      if (status) query = query.eq("status", status);
      if (q) query = query.ilike("title", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
      if (params.get("eligible") === "true" || (targetMatches && params.get("eligible") !== "false"))
        query = query.neq("status", "excluded").or(`deadline_at.is.null,deadline_at.gte.${this.now.toISOString()}`);
      if (targetProgramIds) query = query.in("id", targetProgramIds);
      return query.order("created_at", { ascending: false }).order("id");
    };
    const rows: Row[] = [];
    if (targetMatches) {
      const ids = targetMatches.map(row => String(row.program_id));
      for (let offset = 0; offset < ids.length; offset += 100)
        rows.push(...await allRows((start, end) => query(ids.slice(offset, offset + 100)).range(start, end).overrideTypes<Row[], { merge: false }>()));
    } else rows.push(...checked(await query().range(offset, offset + limit).overrideTypes<Row[], { merge: false }>()) ?? []);
    let sorted: Row[] = rows;
    if (targetMatches) {
      const positions = new Map(targetMatches.map((row, index) => [row.program_id, index]));
      const preferred = rows.some(row => targetMatches!.some(match => match.program_id === row.id && match.verdict === "candidate")) ? "candidate" : "unknown";
      sorted = rows.filter(row => targetMatches!.some(match => match.program_id === row.id && match.verdict === preferred))
        .sort((a, b) => positions.get(a.id)! - positions.get(b.id)!).slice(offset, offset + limit + 1);
    }
    const revision = targetMatches ? await this.contextRevision() : null;
    return { programs: await Promise.all(sorted.slice(0, limit).map(async row => ({ ...programDto(row),
      ...(targetMatches ? { match: matchDto(targetMatches.find(match => match.program_id === row.id)!),
        matches_stale: await this.matchesStale(String(row.id), await this.requirement(String(row.id)), revision!) } : {}),
    }))), limit, offset, has_more: sorted.length > limit };
  }
  async appendReview(id: string, body: Row) {
    await this.program(id);
    strictKeys(body, ["target_kind", "target_id", "target_name", "conclusion", "review_markdown", "missing_documents", "next_actions"]);
    const target = await this.target(body.target_kind, body.target_id);
    if (body.target_name !== undefined && body.target_name !== target.name) throw new ProgramApiError(400, "TARGET_NAME_MISMATCH");
    if (!["추천", "검토", "제외", "확인 필요"].includes(String(body.conclusion))) throw new ProgramApiError(400, "INVALID_CONCLUSION");
    const review = { program_id: id, target_kind: target.kind, target_id: target.id, target_name: target.name,
      conclusion: body.conclusion, review_markdown: boundedText(body.review_markdown, 50_000),
      missing_documents: stringList(body.missing_documents ?? []), next_actions: stringList(body.next_actions ?? []), reviewer: "ai:gongo-matcher" };
    const result = checked(await this.admin.from("openchat_program_reviews").insert(review).select("id,created_at").single());
    return { review: result };
  }
  async proposeProfile(key: string, body: Row) {
    profileKey(key); strictKeys(body, ["base_version", "patch", "reason"]);
    if (!Number.isSafeInteger(body.base_version) || Number(body.base_version) < 1) throw new ProgramApiError(400, "INVALID_VERSION");
    const current = (await readApprovedSelfProfiles(this.admin)).find(row => row.id === key)!;
    if (current.version !== body.base_version) throw new ProgramApiError(409, "PROFILE_VERSION_CONFLICT");
    const proposal = { profile_id: key, base_version: body.base_version, patch: validateProfilePatch(body.patch),
      reason: boundedText(body.reason, 2000), status: "pending", submitted_by: "ai:gongo-matcher" };
    const result = checked(await this.admin.from("openchat_program_profile_proposals").insert(proposal).select("id,profile_id,status,base_version,created_at").single());
    return { proposal: result };
  }
}
