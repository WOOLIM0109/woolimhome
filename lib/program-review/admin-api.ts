import type { SupabaseClient } from "@supabase/supabase-js";
import { ProgramAgentService, requireUuid } from "./agent-api.ts";
import { hasCredentialLikeValue, ProgramApiError } from "./agent-auth.ts";
import { applySelfProfileProposal, readApprovedSelfProfiles, strictKeys } from "./profiles-store.ts";
import { entityTargetId, entityTargetName, fetchWoolimworksCustomers, groupByCustomer,
  isConsultingCustomer, listActiveCustomerProfiles, listCustomerProfiles,
  missingFields, parseSave, saveCustomerProfile } from "./customer-profiles.ts";
import { buildCustomerDeliveries, customerIdOf, DELIVERY_SEND_LIMIT, type DeliveryRequirement } from "./customer-delivery.ts";

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
function dateKst(now: Date) { return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
// 쓰는 칸만 읽는다 (요건 전체는 근거 문장까지 들어 있어 크다). `: string` 은 PostgREST 타입 추론이 별칭을 못 읽어서다.
const DELIVERY_REQUIREMENT_COLUMNS: string = "program_id,matched_profile_revision,support_amount_text:requirements->support_amount_text,"
  + "submission_documents:requirements->submission_documents,deadline_at:requirements->>deadline_at";
function deliveryCustomer(value: unknown) {
  // 울림웍스 고객 id. 사업자(`:` 뒤)가 아니라 고객사 단위로 적는다.
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && value === value.trim()
    && !value.includes(":") && !/[\u0000-\u001f\u007f]/.test(value);
}
function realDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
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
    // 판정 단위는 사업자입니다. 요건을 적어 둔 고객사는 사업자마다 한 줄로 펼쳐
    // 보여야 매칭 결과와 고르는 칸이 어긋나지 않습니다.
    const saved = await listActiveCustomerProfiles(this.admin);
    const byCustomer = groupByCustomer(saved);
    const customerTargets = Array.isArray(cacheRow?.payload)
      ? (cacheRow.payload as Row[])
        .filter(row => typeof row.id === "string" && typeof row.name === "string")
        .flatMap(row => {
          const id = String(row.id), name = String(row.name);
          const entities = byCustomer.get(id) ?? [];
          if (!entities.length) return [{ kind: "customer" as const, id, name }];
          return entities.map(entity => ({ kind: "customer" as const,
            id: entityTargetId(id, entity.entity_key),
            name: entityTargetName(name, entity.entity_name, entities.length > 1) }));
        })
      : [];
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

  /**
   * '고객사 전달' 탭. 가장 최근 판정일(오늘 이전 포함)의 후보를 고객사마다 모아
   * 보낼 문구를 만듭니다. 이미 보낸 공고는 뺍니다. 보내는 것은 사람이 합니다.
   */
  async deliveries() {
    const today = dateKst(this.now);
    const latest = checked(await this.admin.from("openchat_program_matches").select("review_date")
      .eq("target_kind", "customer").lte("review_date", today).order("review_date", { ascending: false })
      .limit(1).maybeSingle()) as Row | null;
    const reviewDate = typeof latest?.review_date === "string" ? latest.review_date : null;
    const sentToday = await allRows((start, end) => this.admin.from("openchat_program_deliveries")
      .select("id,customer_id,program_id,review_date,delivered_by,delivered_at")
      .gte("delivered_at", new Date(Date.parse(`${today}T00:00:00+09:00`)).toISOString())
      .order("delivered_at", { ascending: false }).order("id").range(start, end));
    const cache = checked(await this.admin.from("openchat_match_profiles_cache").select("payload").not("fetched_at", "is", null)
      .order("fetched_at", { ascending: false }).limit(1).maybeSingle()) as Row | null;
    const names = new Map<string, string>();
    if (Array.isArray(cache?.payload)) for (const row of cache.payload as Row[])
      if (typeof row.id === "string" && typeof row.name === "string") names.set(row.id, row.name);
    const matches = !reviewDate ? [] : await allRows((start, end) => this.admin.from("openchat_program_matches")
      .select("program_id,target_id,target_name,verdict,reasons,score").eq("review_date", reviewDate)
      .eq("target_kind", "customer").eq("verdict", "candidate").order("program_id").order("target_id").range(start, end));
    const ids = [...new Set([...matches, ...sentToday].map(row => String(row.program_id)))];
    const programs: Row[] = [], requirements: Row[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const [p, r] = await Promise.all([
        allRows((start, end) => this.admin.from("openchat_programs").select("id,title,source_url,deadline_at,status,event_like:raw_payload->>event_like")
          .in("id", chunk).order("id").range(start, end)),
        // 쓰는 칸만 읽는다. 요건 전체(근거 문장 포함)는 공고마다 크다.
        allRows((start, end) => this.admin.from("openchat_program_requirements")
          .select(DELIVERY_REQUIREMENT_COLUMNS)
          .in("program_id", chunk).order("program_id").range(start, end) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>),
      ]);
      programs.push(...p); requirements.push(...r);
    }
    // 오늘 후보인 공고에 대한 기록만 읽는다. 고객사 전체 기록을 읽으면 쌓일수록 무거워진다.
    const candidateIds = [...new Set(matches.map(row => String(row.program_id)))];
    const delivered: Row[] = [];
    for (let offset = 0; offset < candidateIds.length; offset += 100) delivered.push(...await allRows((start, end) =>
      this.admin.from("openchat_program_deliveries").select("customer_id,program_id")
        .in("program_id", candidateIds.slice(offset, offset + 100)).order("id").range(start, end)));
    // 고객사·자사 정보가 바뀐 뒤 아직 다시 판정하지 않은 공고. 그 판정은 예전 정보로 한 것이다.
    const context = !candidateIds.length ? null : checked(await this.admin.from("openchat_program_match_context")
      .select("revision").eq("id", "current").maybeSingle()) as Row | null;
    const staleIds = new Set(context ? requirements.filter(row => String(row.matched_profile_revision) !== String(context.revision))
      .map(row => String(row.program_id)) : []);
    // 판정은 평일 아침에 몇 번에 나눠 저장된다. 오늘 판정을 보고 있는데 아직 판정할 공고가 남아 있으면 알린다.
    // (시각으로만 가늠하면 10시 넘어 덜 끝난 날을 놓친다)
    let pendingJudging = 0;
    if (reviewDate === today) {
      const { data, error } = await this.admin.rpc("openchat_review_queue_status", { p_review_date: today, p_include_excluded: false });
      const ready = !error && data && typeof data === "object" ? Number((data as Row).ready) : NaN;
      pendingJudging = Number.isSafeInteger(ready) && ready > 0 ? ready : 0;
    }
    const list = buildCustomerDeliveries({
      matches: matches.map(row => ({ program_id: String(row.program_id), target_id: String(row.target_id),
        target_name: String(row.target_name), verdict: String(row.verdict), reasons: strings(row.reasons), score: Number(row.score) || 0 })),
      programs: programs.map(row => ({ id: String(row.id), title: String(row.title ?? ""), status: String(row.status ?? ""),
        source_url: typeof row.source_url === "string" ? row.source_url : null,
        deadline_at: typeof row.deadline_at === "string" ? row.deadline_at : null,
        event_like: row.event_like === true || row.event_like === "true" })),
      requirements: new Map(requirements.map(row => [String(row.program_id), {
        support_amount_text: row.support_amount_text, submission_documents: row.submission_documents,
        deadline_at: row.deadline_at } as DeliveryRequirement])),
      delivered: new Set(delivered.map(row => `${row.customer_id}|${row.program_id}`)),
      customerNames: names, now: this.now,
    });
    const titles = new Map(programs.map(row => [String(row.id), String(row.title ?? "")]));
    return { as_of: this.now.toISOString(), today, review_date: reviewDate, customers: list,
      // 화면에 실제로 보이는 공고만 센다 (마감 지남·이미 보낸 공고는 빼고)
      stale_programs: new Set(list.flatMap(row => row.items.map(item => item.program_id)).filter(id => staleIds.has(id))).size,
      pending_judging: pendingJudging,
      sent_today: sentToday.map(row => ({ id: String(row.id), customer_id: String(row.customer_id),
        customer_name: names.get(String(row.customer_id)) ?? String(row.customer_id), program_id: String(row.program_id),
        title: titles.get(String(row.program_id)) ?? "", delivered_by: String(row.delivered_by), delivered_at: String(row.delivered_at) })) };
  }

  /** '보냈어요'. 그날 그 고객사의 후보였던 공고만 적습니다. 이미 적힌 것은 그대로 둡니다. */
  async markDelivered(body: Record<string, unknown> | undefined, actor: string) {
    if (!body) throw new ProgramApiError(400, "INVALID_DELIVERY");
    strictKeys(body, ["customer_id", "program_ids", "review_date"]);
    const customerId = body.customer_id, reviewDate = body.review_date, programIds = body.program_ids;
    if (!deliveryCustomer(customerId) || !realDay(reviewDate) || reviewDate > dateKst(this.now)
      || !Array.isArray(programIds) || !programIds.length || programIds.length > DELIVERY_SEND_LIMIT
      || programIds.some(id => typeof id !== "string")) throw new ProgramApiError(400, "INVALID_DELIVERY");
    const ids = [...new Set(programIds as string[])].map(requireUuid);
    const matches = await allRows((start, end) => this.admin.from("openchat_program_matches").select("program_id,target_id")
      .eq("review_date", reviewDate).eq("target_kind", "customer").eq("verdict", "candidate").in("program_id", ids)
      .order("program_id").order("target_id").range(start, end));
    const allowed = new Set(matches.filter(row => customerIdOf(String(row.target_id)) === customerId).map(row => String(row.program_id)));
    if (ids.some(id => !allowed.has(id))) throw new ProgramApiError(409, "NOT_A_CANDIDATE");
    const by = actor.slice(0, 200) || "admin";
    // 충돌하면 건너뛴다. 돌려받는 줄은 이번에 **새로 적힌** 것뿐이라, 둘이 동시에 눌러도 한 사람만 새로 적은 것이 된다.
    const inserted = checked(await this.admin.from("openchat_program_deliveries")
      .upsert(ids.map(id => ({ customer_id: customerId, program_id: id, review_date: reviewDate, delivered_by: by })),
        { onConflict: "customer_id,program_id", ignoreDuplicates: true }).select("program_id")) as Row[] | null ?? [];
    return { delivered: inserted.length, already: ids.length - inserted.length };
  }

  /** 잘못 누른 '보냈어요' 를 되돌립니다. 그 기록 한 줄만 지웁니다. */
  async undoDelivery(body: Record<string, unknown> | undefined) {
    if (!body) throw new ProgramApiError(400, "INVALID_DELIVERY");
    strictKeys(body, ["id"]);
    if (typeof body.id !== "string") throw new ProgramApiError(400, "INVALID_DELIVERY");
    const id = requireUuid(body.id);
    const removed = checked(await this.admin.from("openchat_program_deliveries").delete().eq("id", id).select("id")) as Row[] | null;
    if (!removed?.length) throw new ProgramApiError(404, "DELIVERY_NOT_FOUND");
    return { undone: 1 };
  }

  async saveCustomerProfile(body: Record<string, unknown> | undefined, actor: string) {
    const saved = await saveCustomerProfile(this.admin, parseSave(body), actor);
    return { ...saved, missing: missingFields(saved.profile ?? {}) };
  }
}

export type ProgramAdminOverview = Awaited<ReturnType<ProgramAdminService["overview"]>>;
export type ProgramAdminCustomers = Awaited<ReturnType<ProgramAdminService["customerProfiles"]>>;
export type ProgramAdminDetail = Awaited<ReturnType<ProgramAdminService["detail"]>>;
