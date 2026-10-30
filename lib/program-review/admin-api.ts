import type { SupabaseClient } from "@supabase/supabase-js";
import { ProgramAgentService, requireUuid } from "./agent-api.ts";
import { hasCredentialLikeValue, ProgramApiError } from "./agent-auth.ts";
import { applySelfProfileProposal, readApprovedSelfProfiles, strictKeys } from "./profiles-store.ts";
import { fetchWoolimworksCustomers, isConsultingCustomer, listCustomerProfiles,
  missingFields, parseSave, saveCustomerProfile } from "./customer-profiles.ts";

type Row = Record<string, unknown>;
export type AttachmentSummary = { total: number; supported: number; extracted: number; pending: number; failed: number;
  no_text: number; skipped: number; unsupported: number; stored: number };
export type ProgramReviewDto = { id: string; program_id: string; target_kind: "self" | "customer"; target_id: string;
  target_name: string; conclusion: string; review_markdown: string; missing_documents: string[]; next_actions: string[];
  reviewer: string; created_at: string };
const REVIEW_COLUMNS = "id,program_id,target_kind,target_id,target_name,conclusion,review_markdown,missing_documents,next_actions,reviewer,created_at";
const ATTACHMENT_SUMMARY_COLUMNS = "id,program_id,file_ext,text_status,storage_path,extracted_at,text_chars";
const BUCKET = "program-attachments";
function checked<T>(response: { data: T | null; error: unknown }) {
  if (response.error) throw new ProgramApiError(503, "DATA_UNAVAILABLE"); return response.data;
}
async function allRows(fetchPage: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const result: Row[] = [];
  for (let page = 0; page < 20; page++) {
    const rows = checked(await fetchPage(page * 500, page * 500 + 499)) ?? [];
    result.push(...rows); if (rows.length < 500) return result;
  }
  throw new ProgramApiError(503, "RESULT_SET_TOO_LARGE");
}
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function reviewDto(row: Row): ProgramReviewDto {
  return { id: String(row.id), program_id: String(row.program_id), target_kind: row.target_kind === "self" ? "self" : "customer",
    target_id: String(row.target_id), target_name: String(row.target_name), conclusion: String(row.conclusion),
    review_markdown: String(row.review_markdown), missing_documents: strings(row.missing_documents), next_actions: strings(row.next_actions),
    reviewer: String(row.reviewer), created_at: String(row.created_at) };
}
function supported(row: Row) { return ["hwp", "hwpx", "pdf"].includes(String(row.file_ext)); }
function attachmentSummary(rows: Row[]): AttachmentSummary {
  const docs = rows.filter(supported);
  return { total: rows.length, supported: docs.length, extracted: docs.filter(row => row.text_status === "extracted").length,
    pending: docs.filter(row => row.text_status === "pending").length, failed: docs.filter(row => row.text_status === "failed").length,
    no_text: docs.filter(row => row.text_status === "no_text").length, skipped: docs.filter(row => row.text_status === "skipped").length,
    unsupported: rows.filter(row => !supported(row) && row.file_ext !== "zip").length, stored: rows.filter(row => Boolean(row.storage_path)).length };
}
export function sanitizeSourceError(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (hasCredentialLikeValue(value) || /\b(?:authorization|cookie|set-cookie|x-api-key)\s*:/i.test(value)) return "수집 오류 상세는 비공개입니다.";
  return [...value].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[주소 비공개]").replace(/\s+/g, " ").slice(0, 300);
}
function storagePathForProgram(path: unknown, programId: string): path is string {
  if (typeof path !== "string" || path.includes("..")) return false;
  const parts = path.split("/");
  return parts.length === 4 && /^\d{4}$/.test(parts[0]) && /^(?:0[1-9]|1[0-2])$/.test(parts[1])
    && parts[2] === programId && /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,1023}$/.test(parts[3]);
}

/** The caller must authenticate an administrator before constructing this DAL. */
export class ProgramAdminService {
  private readonly agent: ProgramAgentService;
  constructor(private readonly admin: SupabaseClient, private readonly now = new Date(), private readonly storageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL) {
    this.agent = new ProgramAgentService(admin, now);
  }
  private async attachments(ids: string[]) {
    const result: Row[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) result.push(...await allRows((start, end) =>
      this.admin.from("openchat_program_attachments").select(ATTACHMENT_SUMMARY_COLUMNS).in("program_id", ids.slice(offset, offset + 100))
        .order("id").range(start, end).abortSignal(AbortSignal.timeout(15_000))));
    return result;
  }
  private async latestReviews(ids: string[]) {
    const result: Row[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) result.push(...await allRows((start, end) =>
      this.admin.from("openchat_program_reviews").select(REVIEW_COLUMNS).in("program_id", ids.slice(offset, offset + 100))
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, end).abortSignal(AbortSignal.timeout(15_000))));
    result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    const seen = new Set<string>();
    return result.filter(row => {
      const key = JSON.stringify([row.program_id, row.target_kind, row.target_id]);
      if (seen.has(key)) return false; seen.add(key); return true;
    }).map(reviewDto);
  }
  private async enrichPrograms<T extends object>(programs: T[]) {
    const ids = programs.map(row => String((row as Row).id));
    const [attachments, reviews] = await Promise.all([this.attachments(ids), this.latestReviews(ids)]);
    return programs.map(row => ({ ...row, attachments_summary: attachmentSummary(attachments.filter(a => a.program_id === (row as Row).id)),
      latest_reviews: reviews.filter(review => review.program_id === (row as Row).id) }));
  }
  async searchPrograms(params: URLSearchParams) {
    const result = await this.agent.searchPrograms(params);
    return { ...result, programs: await this.enrichPrograms(result.programs) };
  }
  async detail(id: string) {
    const result = await this.agent.detail(id); // Establish program scope before private review/storage reads.
    const [latestReviews, attachments] = await Promise.all([this.latestReviews([id]), this.attachments([id])]);
    return { ...result, latest_reviews: latestReviews, attachments_summary: attachmentSummary(attachments),
      attachments: result.attachments.map(row => ({ ...row, download_available: attachments.some(a => a.id === row.id && storagePathForProgram(a.storage_path, id)) })) };
  }
  text(id: string, attachmentId?: string) { return this.agent.text(id, attachmentId); }
  async reviewProposal(id: string, body: Row, actor: string) {
    requireUuid(id); strictKeys(body, ["expected_version", "approve"]);
    if (typeof body.expected_version !== "number" || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1
      || typeof body.approve !== "boolean") throw new ProgramApiError(400, "INVALID_APPROVAL");
    return { proposal: await applySelfProfileProposal(this.admin, id, body.expected_version, actor, body.approve) };
  }
  async download(programId: string, attachmentId: string) {
    requireUuid(programId); requireUuid(attachmentId);
    const cutoff = new Date(this.now.getTime() - 60 * 86400_000).toISOString();
    const program = checked(await this.admin.from("openchat_programs").select("id").eq("id", programId).gte("created_at", cutoff).maybeSingle());
    if (!program) throw new ProgramApiError(404, "PROGRAM_NOT_FOUND");
    const attachment = checked(await this.admin.from("openchat_program_attachments").select("id,file_name,storage_path")
      .eq("program_id", programId).eq("id", attachmentId).maybeSingle()) as Row | null;
    if (!attachment) throw new ProgramApiError(404, "ATTACHMENT_NOT_FOUND");
    if (!storagePathForProgram(attachment.storage_path, programId)) throw new ProgramApiError(409, "ORIGINAL_UNAVAILABLE");
    const bucket = await this.admin.storage.getBucket(BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public !== false) throw new ProgramApiError(503, "PRIVATE_STORAGE_UNAVAILABLE");
    const name = typeof attachment.file_name === "string" ? attachment.file_name.replace(/[\\/\r\n]/g, "_").slice(0, 180) : "attachment";
    const signed = await this.admin.storage.from(BUCKET).createSignedUrl(attachment.storage_path, 600, { download: name });
    if (signed.error || !signed.data?.signedUrl) throw new ProgramApiError(503, "DOWNLOAD_UNAVAILABLE");
    try {
      const expectedOrigin = new URL(this.storageOrigin ?? "");
      const url = new URL(signed.data.signedUrl), prefix = `/storage/v1/object/sign/${BUCKET}/`;
      if (expectedOrigin.protocol !== "https:" || url.origin !== expectedOrigin.origin || url.username || url.password
        || !url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname.slice(prefix.length)) !== attachment.storage_path)
        throw new Error();
      // Signed credentials travel only in this authorized redirect, never in JSON or the DOM.
      return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "private, no-store",
        Vary: "Cookie", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    } catch { throw new ProgramApiError(503, "DOWNLOAD_UNAVAILABLE"); }
  }
  private async institutions() {
    const since = new Date(this.now.getTime() - 60 * 86400_000).toISOString();
    const [sources, programs] = await Promise.all([
      this.admin.from("openchat_sources").select("id,source_key,name,category,enabled,last_checked_at,last_succeeded_at,last_status,last_error").order("priority"),
      allRows((start, end) => this.admin.from("openchat_programs").select("id,source_id,deadline_at").gte("created_at", since).order("id").range(start, end)),
    ]);
    const sourceRows = checked(sources) as Row[] | null;
    const confirmed = programs.filter(row => typeof row.deadline_at === "string" && Date.parse(row.deadline_at) >= this.now.getTime());
    const ids = confirmed.map(row => String(row.id)), discoveries: Row[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) discoveries.push(...await allRows((start, end) =>
      this.admin.from("openchat_program_attachment_discovery").select("program_id,status,checked_at").in("program_id", ids.slice(offset, offset + 100))
        .order("program_id").range(start, end)));
    const attachments = await this.attachments(ids);
    return (sourceRows ?? []).map(source => {
      const items = confirmed.filter(row => row.source_id === source.id), programIds = new Set(items.map(row => row.id));
      const d = discoveries.filter(row => programIds.has(row.program_id)), a = attachments.filter(row => programIds.has(row.program_id));
      const docs = a.filter(supported), textPrograms = new Set(docs.filter(row => row.text_status === "extracted" && Number(row.text_chars) > 0).map(row => row.program_id));
      const newest = (values: unknown[]) => values.filter((v): v is string => typeof v === "string").sort().at(-1) ?? null;
      return { id: source.id, source_key: source.source_key, name: source.name, category: source.category, enabled: source.enabled,
        last_checked_at: source.last_checked_at, last_succeeded_at: source.last_succeeded_at, last_status: source.last_status,
        last_error: sanitizeSourceError(source.last_error), programs: items.length,
        deadline_unknown_programs: programs.filter(row => row.source_id === source.id && row.deadline_at === null).length,
        recent_programs: programs.filter(row => row.source_id === source.id).length,
        discovered_programs: d.filter(row => row.status === "found").length, no_links: d.filter(row => row.status === "none").length,
        discovery_failed: d.filter(row => row.status === "failed").length, unvisited: items.length - d.length, text_programs: textPrograms.size,
        supported_documents: docs.length, supported_extracted: docs.filter(row => row.text_status === "extracted").length,
        supported_failed: docs.filter(row => row.text_status === "failed").length, supported_no_text: docs.filter(row => row.text_status === "no_text").length,
        supported_skipped: docs.filter(row => row.text_status === "skipped").length,
        unsupported_documents: a.filter(row => !supported(row) && row.file_ext !== "zip").length,
        zip_containers: a.filter(row => row.file_ext === "zip").length,
        attachment_warning: items.length > 0 && (textPrograms.size < items.length || docs.some(row => row.text_status !== "extracted")),
        discovery_last_checked_at: newest(d.map(row => row.checked_at)), attachment_last_extracted_at: newest(a.map(row => row.extracted_at)) };
    });
  }
  async overview() {
    const [today, profiles, institutions, proposals, cache] = await Promise.all([
      this.agent.today(), readApprovedSelfProfiles(this.admin), this.institutions(),
      allRows((start, end) => this.admin.from("openchat_program_profile_proposals")
        .select("id,profile_id,base_version,patch,reason,status,submitted_by,created_at").eq("status", "pending").order("created_at").order("id").range(start, end)),
      this.admin.from("openchat_match_profiles_cache").select("payload,fetched_at,expires_at").not("fetched_at", "is", null)
        .gt("expires_at", this.now.toISOString()).order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const cacheRow = checked(cache) as Row | null;
    const customerTargets = Array.isArray(cacheRow?.payload) ? (cacheRow.payload as Row[]).filter(row => typeof row.id === "string" && typeof row.name === "string")
      .map(row => ({ kind: "customer" as const, id: String(row.id), name: String(row.name) })) : [];
    return { as_of: this.now.toISOString(), scope: { lookback_days: 60, attachment_scope: "confirmed_future", deadline_unknown_separate: true },
      today: { ...today, programs: await this.enrichPrograms(today.programs) }, profiles,
      targets: [...profiles.map(row => ({ kind: "self" as const, id: row.id, name: row.name })), ...customerTargets],
      customer_cache: { available: Boolean(cacheRow), fetched_at: cacheRow?.fetched_at ?? null, expires_at: cacheRow?.expires_at ?? null },
      proposals: proposals.map(row => ({ id: row.id, profile_id: row.profile_id, base_version: row.base_version, patch: row.patch,
        reason: row.reason, status: row.status, submitted_by: row.submitted_by, created_at: row.created_at })), institutions };
  }

  /**
   * 고객사 요건 화면이 쓰는 목록.
   *
   * 고객 원본은 울림웍스입니다. 거기서 한 번 읽고(상세는 묻지 않습니다),
   * 우리가 덧붙여 둔 요건을 붙여서 돌려줍니다. 무엇을 더 적어야 하는지도
   * 같이 알려 줘서 화면이 빈칸을 바로 보여 줄 수 있게 합니다.
   */
  async customerProfiles() {
    const [customers, saved] = await Promise.all([
      fetchWoolimworksCustomers(), listCustomerProfiles(this.admin),
    ]);
    const byCustomer = new Map<string, typeof saved>();
    for (const row of saved) {
      const rows = byCustomer.get(row.customer_id) ?? [];
      rows.push(row); byCustomer.set(row.customer_id, rows);
    }
    const entity = (row: (typeof saved)[number]) => ({
      id: row.id, entity_key: row.entity_key, entity_name: row.entity_name,
      business_number: row.business_number, profile: row.profile, active: row.active,
      version: row.version, updated_by: row.updated_by, updated_at: row.updated_at,
      missing: missingFields(row.profile ?? {}),
    });
    const rows = customers.map(customer => ({
      ...customer, consulting: isConsultingCustomer(customer),
      entities: (byCustomer.get(customer.id) ?? []).map(entity),
    }));
    // 우리가 적어 둔 요건인데 울림웍스 목록에 없는 고객. 연결이 끊긴 것이라
    // 조용히 감추면 적어 둔 것이 사라진 것처럼 보입니다.
    const known = new Set(customers.map(row => row.id));
    const orphans = saved.filter(row => !known.has(row.customer_id))
      .map(row => ({ customer_id: row.customer_id, ...entity(row) }));
    return {
      as_of: this.now.toISOString(),
      consulting_count: rows.filter(row => row.consulting).length,
      customers: rows, orphans,
    };
  }

  async saveCustomerProfile(body: Record<string, unknown> | undefined, actor: string) {
    const saved = await saveCustomerProfile(this.admin, parseSave(body), actor);
    return { ...saved, missing: missingFields(saved.profile ?? {}) };
  }
}

export type ProgramAdminOverview = Awaited<ReturnType<ProgramAdminService["overview"]>>;
export type ProgramAdminCustomers = Awaited<ReturnType<ProgramAdminService["customerProfiles"]>>;
export type ProgramAdminDetail = Awaited<ReturnType<ProgramAdminService["detail"]>>;
