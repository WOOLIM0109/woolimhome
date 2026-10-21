import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  customerMatchProfile, hasCustomerSupportProject, hasRecentRegisteredProject, selfMatchProfiles,
  WOOLIMWORKS_API_FIELD_NAMES,
  type AgentCustomer, type AgentProject, type CachedCustomerProfile, type MatchProfile,
} from "./profiles.ts";

const ORIGIN = "https://hub.woolimcompany.kr";
const CACHE_TABLE = "openchat_match_profiles_cache";
const SELF_TABLE = "openchat_program_self_profiles";
const CONTEXT_TABLE = "openchat_program_match_context";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const inFlight = new WeakMap<SupabaseClient, Map<string, Promise<MatchProfile[]>>>();

export class MatchProfilesError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "MatchProfilesError"; this.code = code; }
}

export type LoadMatchProfilesOptions = {
  now?: Date;
  fetchImpl?: typeof fetch;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  requestIntervalMs?: number;
  maxDurationMs?: number;
  requestTimeoutMs?: number;
  maxDetailsPerRun?: number;
};

type StagedCustomer = CachedCustomerProfile & { hasRecentProject: boolean };
type RefreshState = { version: 1; basisNow: string; customers: StagedCustomer[]; cursor: number };

function failure(code: string, message: string): never { throw new MatchProfilesError(code, message); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optionalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") failure("api_contract", "고객 읽기 API의 필드 형식이 올바르지 않습니다.");
  return value.trim() || null;
}
function requiredText(value: unknown) {
  const result = optionalText(value);
  if (!result) failure("api_contract", "고객 읽기 API의 필수 필드가 누락됐습니다.");
  return result;
}
function collection(body: unknown, key: string): Record<string, unknown>[] {
  if (!record(body) || !Array.isArray(body[key]) || Object.keys(body).some((name) => name !== key)
    || !body[key].every(record)) failure("api_contract", "고객 읽기 API의 목록 응답 형식이 올바르지 않습니다.");
  return body[key];
}

function customersFromResponse(body: unknown): AgentCustomer[] {
  const seen = new Set<string>();
  return collection(body, "customers").flatMap((row) => {
    if (row.active === false || row.customerKind === "partner") return [];
    const id = requiredText(row.id);
    if (seen.has(id)) failure("api_contract", "고객 읽기 API에 중복 식별자가 있습니다.");
    seen.add(id);
    return [{ id, name: optionalText(row.companyName) || requiredText(row.name),
      region: optionalText(row.region), foundedOn: optionalText(row.foundedOn) }];
  });
}

function projectsFromResponse(body: unknown): AgentProject[] {
  const seen = new Set<string>();
  return collection(body, "projects").flatMap((row) => {
    if (row.active === false) return [];
    const id = requiredText(row.id);
    if (seen.has(id)) failure("api_contract", "프로젝트 읽기 API에 중복 식별자가 있습니다.");
    seen.add(id);
    const createdAt = requiredText(row.createdAt);
    if (!Number.isFinite(Date.parse(createdAt))) failure("api_contract", "프로젝트 등록일 형식이 올바르지 않습니다.");
    return [{ id, customerId: optionalText(row.customerId) || "", projectCategory: requiredText(row.projectCategory), createdAt }];
  });
}

function legacyHistory(body: unknown, customerId: string) {
  if (!record(body) || !record(body.customer) || body.customer.id !== customerId
    || !Array.isArray(body.projects) || !Array.isArray(body.legacyPrograms) || !Array.isArray(body.quoteRequests)
    || body.legacyPrograms.some((row) => !record(row) || typeof row.id !== "string" || !row.id || row.customerId !== customerId)) {
    failure("api_contract", "고객 상세 API의 이력 응답 형식이 올바르지 않습니다.");
  }
  return body.legacyPrograms.length > 0;
}

function cacheDate(now: Date) { return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }

function parseCachedProfiles(payload: unknown): CachedCustomerProfile[] | null {
  if (!Array.isArray(payload)) return null;
  const keys = ["id", "name", "region", "foundedOn", "hasSupportHistory"];
  const seen = new Set<string>();
  for (const row of payload) {
    if (!record(row) || Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))
      || typeof row.id !== "string" || !row.id.trim() || seen.has(row.id)
      || typeof row.name !== "string" || !row.name.trim()
      || (row.region !== null && typeof row.region !== "string")
      || (row.foundedOn !== null && typeof row.foundedOn !== "string")
      || typeof row.hasSupportHistory !== "boolean") return null;
    seen.add(row.id);
  }
  return payload.map((row) => ({ id: row.id, name: row.name, region: row.region, foundedOn: row.foundedOn, hasSupportHistory: row.hasSupportHistory }));
}

async function readCache(admin: SupabaseClient, day: string, now: Date) {
  const { data, error } = await admin.from(CACHE_TABLE).select("payload,fetched_at,expires_at").eq("cache_date", day).maybeSingle();
  if (error) failure("cache_read", "고객 프로필 캐시를 읽지 못했습니다.");
  if (!data || !data.fetched_at || !Number.isFinite(Date.parse(data.fetched_at))
    || !(Date.parse(data.expires_at) > now.getTime())) return null;
  return parseCachedProfiles(data.payload);
}

async function matchProfiles(admin: SupabaseClient, customers: CachedCustomerProfile[]) {
  const { data, error } = await admin.from(SELF_TABLE).select("id,name,aliases,profile,version");
  if (error || !Array.isArray(data)) failure("self_profiles_read", "승인된 자사 프로필을 읽지 못했습니다.");
  let self: MatchProfile[];
  try { self = selfMatchProfiles(data); }
  catch { failure("self_profiles_contract", "승인된 자사 프로필 형식이 올바르지 않습니다."); }
  return [...self, ...customers.map(customerMatchProfile)];
}

function parseState(value: unknown, day: string): RefreshState | null {
  if (value === null || value === undefined) return null;
  const stateKeys = ["version", "basisNow", "customers", "cursor"];
  if (!record(value) || value.version !== 1 || typeof value.basisNow !== "string"
    || !Number.isFinite(Date.parse(value.basisNow)) || cacheDate(new Date(value.basisNow)) !== day
    || !Array.isArray(value.customers) || !Number.isInteger(value.cursor)
    || typeof value.cursor !== "number" || value.cursor < 0 || value.cursor > value.customers.length
    || Object.keys(value).length !== stateKeys.length || Object.keys(value).some((key) => !stateKeys.includes(key))) {
    failure("cache_state", "고객 프로필 갱신 진행 정보가 올바르지 않습니다.");
  }
  const seen = new Set<string>();
  const customers: StagedCustomer[] = value.customers.map((row) => {
    if (!record(row) || Object.keys(row).length !== 6 || typeof row.hasRecentProject !== "boolean") {
      failure("cache_state", "고객 프로필 갱신 진행 정보가 올바르지 않습니다.");
    }
    const { hasRecentProject, ...minimal } = row;
    const parsed = parseCachedProfiles([minimal]);
    if (!parsed || seen.has(parsed[0].id)) failure("cache_state", "고객 프로필 갱신 진행 정보가 올바르지 않습니다.");
    seen.add(parsed[0].id);
    return { ...parsed[0], hasRecentProject };
  });
  return { version: 1, basisNow: value.basisNow, customers, cursor: value.cursor };
}

async function refresh(admin: SupabaseClient, day: string, now: Date, options: LoadMatchProfilesOptions) {
  const owner = randomUUID();
  const { data: claimed, error } = await admin.rpc("claim_openchat_match_profiles_refresh", { p_cache_date: day, p_owner: owner });
  if (error) failure("cache_claim", "고객 프로필 갱신 잠금을 확보하지 못했습니다.");
  if (claimed !== true) {
    const cached = await readCache(admin, day, now);
    if (cached) return matchProfiles(admin, cached);
    failure("refresh_in_progress", "다른 실행에서 고객 프로필을 갱신 중입니다.");
  }
  let finished = false;
  try {
    const token = process.env.WOOLIMWORKS_AGENT_TOKEN?.trim();
    if (!token) failure("api_token_missing", "고객 읽기 API 인증이 설정되지 않았습니다.");
    const fetchImpl = options.fetchImpl || fetch;
    const clock = options.clock || Date.now;
    const startedAt = clock();
    const configuredMaximum = options.maxDurationMs ?? 90_000;
    const configuredInterval = options.requestIntervalMs ?? 1100;
    const configuredTimeout = options.requestTimeoutMs ?? 20_000;
    const configuredDetailLimit = options.maxDetailsPerRun ?? 40;
    if (![configuredMaximum, configuredInterval, configuredTimeout, configuredDetailLimit].every(Number.isFinite)
      || configuredMaximum <= 0 || configuredInterval < 0 || configuredTimeout <= 0 || configuredDetailLimit < 1) {
      failure("invalid_options", "고객 프로필 갱신 설정이 올바르지 않습니다.");
    }
    const maximum = Math.min(configuredMaximum, 9 * 60 * 1000);
    const interval = configuredInterval;
    const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    let lastRequestAt = -Infinity;
    async function request(path: string): Promise<unknown> {
      const delay = Math.max(0, lastRequestAt + interval - clock());
      if (clock() - startedAt + delay >= maximum) failure("refresh_timeout", "고객 프로필 갱신의 실행 시간이 초과됐습니다.");
      if (delay) await sleep(delay);
      const remaining = maximum - (clock() - startedAt);
      if (remaining <= 0) failure("refresh_timeout", "고객 프로필 갱신의 실행 시간이 초과됐습니다.");
      const url = new URL(path, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password) failure("api_origin", "허용되지 않은 고객 API 주소입니다.");
      lastRequestAt = clock();
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          redirect: "manual", cache: "no-store",
          signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(configuredTimeout, remaining)))),
        });
      } catch { failure("api_request", "고객 읽기 API 요청에 실패했습니다."); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status >= 300 && response.status < 400) failure("api_redirect", "고객 읽기 API의 리다이렉트를 허용하지 않습니다.");
        if ([401, 403].includes(response.status)) failure("api_auth", "고객 읽기 API 인증 또는 권한 확인에 실패했습니다.");
        if (response.status === 429) failure("api_rate_limit", "고객 읽기 API 요청 한도를 초과했습니다.");
        failure("api_response", "고객 읽기 API가 정상 응답하지 않았습니다.");
      }
      try { return await response.json(); } catch { failure("api_contract", "고객 읽기 API가 올바른 JSON을 반환하지 않았습니다."); }
    }
    const stored = await admin.from(CACHE_TABLE).select("refresh_state").eq("cache_date", day).maybeSingle();
    if (stored.error) failure("cache_read", "고객 프로필 갱신 진행 정보를 읽지 못했습니다.");
    let state = parseState(stored.data?.refresh_state, day);
    if (!state) {
      const customers = customersFromResponse(await request("/api/agent/customers"));
      const projects = projectsFromResponse(await request("/api/agent/projects?customerId="));
      const grouped = new Map<string, AgentProject[]>();
      for (const project of projects) {
        const rows = grouped.get(project.customerId) || [];
        rows.push(project); grouped.set(project.customerId, rows);
      }
      state = { version: 1, basisNow: now.toISOString(), cursor: 0,
        customers: customers.map((customer) => {
          const rows = grouped.get(customer.id) || [];
          return { ...customer, hasSupportHistory: hasCustomerSupportProject(rows),
            hasRecentProject: hasRecentRegisteredProject(rows, now) };
        }) };
    }
    const detailLimit = Math.max(1, Math.min(40, Math.floor(configuredDetailLimit)));
    let details = 0;
    for (; state.cursor < state.customers.length; state.cursor += 1) {
      const customer = state.customers[state.cursor];
      // A recent project proves eligibility, but not the absence of legacy
      // support history. Do not silently replace an unresolved history by false.
      if (customer.hasSupportHistory) continue;
      if (details >= detailLimit) break;
      customer.hasSupportHistory = legacyHistory(await request(`/api/agent/customers/${encodeURIComponent(customer.id)}`), customer.id);
      details += 1;
    }
    const completedAt = new Date(now.getTime() + Math.max(0, clock() - startedAt));
    if (cacheDate(completedAt) !== day) failure("refresh_day_changed", "프로필 갱신 중 기준 날짜가 변경됐습니다.");
    if (clock() - startedAt >= maximum) failure("refresh_timeout", "고객 프로필 갱신의 실행 시간이 초과됐습니다.");
    if (state.cursor < state.customers.length) {
      const checkpoint = await admin.rpc("checkpoint_openchat_match_profiles_refresh", {
        p_cache_date: day, p_owner: owner, p_state: state,
      });
      if (checkpoint.error || checkpoint.data !== true) failure("cache_checkpoint", "고객 프로필 갱신 진행 정보를 저장하지 못했습니다.");
      finished = true; // Checkpoint atomically saves staging and releases its lease.
      failure("refresh_pending", "고객 프로필 확인이 진행 중입니다. 다음 실행에서 이어서 확인합니다.");
    }
    const payload: CachedCustomerProfile[] = state.customers
      .filter((customer) => customer.hasRecentProject || customer.hasSupportHistory)
      .map(({ id, name, region, foundedOn, hasSupportHistory }) => ({ id, name, region, foundedOn, hasSupportHistory }));
    const result = await admin.rpc("finish_openchat_match_profiles_refresh", {
      p_cache_date: day, p_owner: owner, p_payload: payload,
      p_field_names: WOOLIMWORKS_API_FIELD_NAMES,
      p_expires_at: new Date(completedAt.getTime() + CACHE_TTL_MS).toISOString(),
    });
    if (result.error || result.data !== true) failure("cache_publish", "완료된 고객 프로필 캐시를 저장하지 못했습니다.");
    finished = true;
    return matchProfiles(admin, payload);
  } catch (error) {
    if (error instanceof MatchProfilesError) throw error;
    failure("refresh_failed", "고객 프로필 갱신을 완료하지 못했습니다.");
  } finally {
    if (!finished) {
      try { await admin.rpc("release_openchat_match_profiles_refresh", { p_cache_date: day, p_owner: owner }); }
      catch { /* The bounded database lease recovers an interrupted release. */ }
    }
  }
}

/** Self profiles plus a complete, private daily customer snapshot; never stale or partial. */
export async function loadMatchProfiles(admin: SupabaseClient, options: LoadMatchProfilesOptions = {}): Promise<MatchProfile[]> {
  try { return await loadProfiles(admin, options); }
  catch (error) {
    if (error instanceof MatchProfilesError) throw error;
    failure("profiles_failed", "고객 프로필을 불러오지 못했습니다.");
  }
}

async function loadProfiles(admin: SupabaseClient, options: LoadMatchProfilesOptions): Promise<MatchProfile[]> {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  if (!Number.isFinite(now.getTime())) failure("invalid_time", "프로필 기준 시각이 올바르지 않습니다.");
  const day = cacheDate(now);
  const cached = await readCache(admin, day, now);
  if (cached) return matchProfiles(admin, cached);
  let pending = inFlight.get(admin);
  if (!pending) { pending = new Map(); inFlight.set(admin, pending); }
  const existing = pending.get(day);
  if (existing) return existing;
  const task = refresh(admin, day, now, options);
  pending.set(day, task);
  try { return await task; }
  finally { pending.delete(day); }
}

export type MatchProfilesSnapshot = { profiles: MatchProfile[]; revision: number };

async function contextRevision(admin: SupabaseClient) {
  const { data, error } = await admin.from(CONTEXT_TABLE).select("revision").eq("id", "current").maybeSingle();
  const revision = typeof data?.revision === "string" && /^\d+$/.test(data.revision) ? Number(data.revision) : data?.revision;
  if (error || !Number.isSafeInteger(revision) || revision < 1) failure("profile_context_read", "매칭 프로필 버전을 확인하지 못했습니다.");
  return revision as number;
}

/** Read a coherent private snapshot; the save RPC rechecks and locks this revision. */
export async function loadMatchProfilesSnapshot(admin: SupabaseClient, options: LoadMatchProfilesOptions = {}): Promise<MatchProfilesSnapshot> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await contextRevision(admin);
      const profiles = await loadMatchProfiles(admin, options);
      const after = await contextRevision(admin);
      if (before === after) return { profiles, revision: after };
    }
    failure("profile_context_changed", "프로필이 변경되어 매칭을 보류했습니다. 다음 실행에서 다시 확인합니다.");
  } catch (error) {
    if (error instanceof MatchProfilesError) throw error;
    failure("profiles_failed", "매칭 프로필 스냅샷을 확인하지 못했습니다.");
  }
}
