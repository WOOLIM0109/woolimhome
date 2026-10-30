import type { SupabaseClient } from "@supabase/supabase-js";
import { ProgramApiError } from "./agent-auth.ts";

/**
 * 고객사 요건을 읽고 씁니다.
 *
 * 고객 원본은 **울림웍스**입니다. 이름·연락처·프로젝트는 거기서 읽고, 여기서는
 * 지원사업 판정에만 필요한 칸(업종·매출·직원수·인증 …)을 덧붙입니다.
 * 울림웍스에 그 칸이 없어서 지금은 판정 축 7개 중 5개가 비어 있습니다.
 *
 * 판정 단위는 **사업자**입니다. 고객사 하나에 사업자가 여럿일 수 있습니다.
 */

const TABLE = "openchat_program_customer_profiles";
/** 울림웍스. `profiles-run.ts` 와 같은 곳을 봅니다. */
const ORIGIN = "https://hub.woolimcompany.kr";

/** 쓸 수 있는 칸. 저장소의 `valid_openchat_self_profile_patch` 와 같아야 합니다. */
const PROFILE_KEYS = ["region", "founded_on", "business_type", "industries", "employees",
  "revenue_krw", "revenue_band", "certifications", "certifications_complete",
  "has_support_history", "notes"] as const;
const BOOLEAN_KEYS = new Set(["certifications_complete", "has_support_history"]);
const LIST_KEYS = new Set(["industries", "certifications"]);
const NUMBER_KEYS = new Set(["employees", "revenue_krw"]);
const BUSINESS_NUMBER = /^\d{3}-\d{2}-\d{5}$/;
const FOUNDED_ON = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

export type CustomerProfileRow = {
  id: string;
  customer_id: string;
  entity_key: string;
  entity_name: string;
  business_number: string | null;
  profile: Record<string, unknown>;
  active: boolean;
  version: number;
  updated_by: string | null;
  updated_at: string;
};

function bad(detail: string): never {
  throw new ProgramApiError(400, `INVALID_CUSTOMER_PROFILE:${detail}`);
}

function text(value: unknown, key: string, max: number, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) bad(key);
    return null;
  }
  if (typeof value !== "string") bad(key);
  const trimmed = value.trim();
  if (!trimmed) { if (required) bad(key); return null; }
  if (trimmed.length > max) bad(key);
  return trimmed;
}

/** 화면에서 온 값을 저장소가 받는 모양으로. 틀린 칸이 있으면 어디가 틀렸는지 알려 줍니다. */
export function parseProfile(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) bad("profile");
  const row = value as Row;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(row)) {
    if (!(PROFILE_KEYS as readonly string[]).includes(key)) bad(`profile.${key}`);
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof item !== "boolean") bad(`profile.${key}`);
      out[key] = item;
      continue;
    }
    // 비운 칸은 '모른다' 입니다. 0 이나 빈 글자로 바꾸지 않습니다 —
    // 모르는 것을 아는 것처럼 저장하면 판정이 조용히 틀립니다.
    if (item === null || item === undefined || item === "") { out[key] = null; continue; }
    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(item) || item.length > 100) bad(`profile.${key}`);
      // 빈 목록을 null 로 바꾸지 않습니다. 인증은 '확인했고 없음' 을 적을 수
      // 있어야 하고, 그래야 '필수 인증' 공고를 판정할 수 있습니다.
      out[key] = item.map((entry) => text(entry, `profile.${key}`, 200, true) as string);
      continue;
    }
    if (NUMBER_KEYS.has(key)) {
      const number = typeof item === "string" ? Number(item.replace(/,/g, "")) : item;
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) bad(`profile.${key}`);
      out[key] = number;
      continue;
    }
    const written = text(item, `profile.${key}`, key === "notes" ? 4000 : 200, true) as string;
    if (key === "founded_on" && !FOUNDED_ON.test(written)) bad("profile.founded_on");
    out[key] = written;
  }
  return out;
}

export type SaveCustomerProfileInput = {
  customer_id: string; entity_key: string; entity_name: string;
  business_number: string | null; profile: Record<string, unknown>; active: boolean;
};

export function parseSave(body: Record<string, unknown> | undefined): SaveCustomerProfileInput {
  if (!body) bad("body");
  const known = ["customer_id", "entity_key", "entity_name", "business_number", "profile", "active"];
  for (const key of Object.keys(body)) if (!known.includes(key)) bad(key);
  const businessNumber = text(body.business_number, "business_number", 20);
  if (businessNumber && !BUSINESS_NUMBER.test(businessNumber)) bad("business_number");
  if (body.active !== undefined && typeof body.active !== "boolean") bad("active");
  return {
    customer_id: text(body.customer_id, "customer_id", 160, true) as string,
    entity_key: text(body.entity_key, "entity_key", 80, true) as string,
    entity_name: text(body.entity_name, "entity_name", 200, true) as string,
    business_number: businessNumber,
    profile: parseProfile(body.profile),
    active: body.active === undefined ? true : body.active as boolean,
  };
}

export async function listCustomerProfiles(admin: SupabaseClient): Promise<CustomerProfileRow[]> {
  const { data, error } = await admin.from(TABLE)
    .select("id,customer_id,entity_key,entity_name,business_number,profile,active,version,updated_by,updated_at")
    .order("customer_id").order("entity_key");
  if (error) throw new ProgramApiError(500, "CUSTOMER_PROFILES_READ_FAILED");
  return (data ?? []) as CustomerProfileRow[];
}

export async function saveCustomerProfile(
  admin: SupabaseClient, input: SaveCustomerProfileInput, actor: string,
): Promise<CustomerProfileRow> {
  const { data, error } = await admin.from(TABLE)
    .upsert({ ...input, updated_by: actor.slice(0, 200) }, { onConflict: "customer_id,entity_key" })
    .select("id,customer_id,entity_key,entity_name,business_number,profile,active,version,updated_by,updated_at")
    .single();
  if (error) throw new ProgramApiError(500, "CUSTOMER_PROFILE_WRITE_FAILED");
  return data as CustomerProfileRow;
}

/** 어느 축이 아직 비어 있는지. 화면이 '무엇을 더 적어야 하는지' 를 보여 줍니다. */
export const JUDGING_FIELDS = ["region", "founded_on", "business_type",
  "industries", "employees", "revenue_krw", "certifications"] as const;

export function missingFields(profile: Record<string, unknown>) {
  return JUDGING_FIELDS.filter((key) => {
    // 인증은 '적어 둔 것이 전부' 라고 확인해야 판정에 쓰입니다 (`matching.ts`).
    // 여기 기준이 거기와 다르면 화면은 '다 찼다' 는데 판정은 '확인 필요' 로 남습니다.
    if (key === "certifications") {
      return !Array.isArray(profile?.certifications) || profile?.certifications_complete !== true;
    }
    const value = profile?.[key];
    if (value === null || value === undefined || value === "") return true;
    return Array.isArray(value) && value.length === 0;
  });
}

export type WoolimworksCustomer = {
  id: string; name: string; region: string | null; founded_on: string | null;
  display_status: string | null; contract_status: string | null; support_projects: number;
};

/**
 * 울림웍스에서 고객 목록을 한 번 읽습니다 (화면의 고르는 칸을 채우려고).
 *
 * `profiles-run.ts` 의 매일 갱신과 달리 **고객 한 곳씩 상세를 묻지 않습니다.**
 * 목록 한 번이라 느리지 않습니다.
 */
export async function fetchWoolimworksCustomers(
  fetchImpl: typeof fetch = fetch,
): Promise<WoolimworksCustomer[]> {
  const token = process.env.WOOLIMWORKS_AGENT_TOKEN?.trim();
  if (!token) throw new ProgramApiError(503, "WOOLIMWORKS_TOKEN_MISSING");
  let response: Response;
  try {
    response = await fetchImpl(`${ORIGIN}/api/agent/customers`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new ProgramApiError(502, "WOOLIMWORKS_REQUEST_FAILED"); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProgramApiError(502, "WOOLIMWORKS_RESPONSE_FAILED");
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new ProgramApiError(502, "WOOLIMWORKS_CONTRACT"); }
  const rows = (body as Row)?.customers;
  if (!Array.isArray(rows)) throw new ProgramApiError(502, "WOOLIMWORKS_CONTRACT");
  return rows.flatMap((value) => {
    const row = value as Row;
    // 협력사와 끊긴 고객은 지원사업 대상이 아닙니다 (profiles-run.ts 와 같은 선).
    if (row.active === false || row.customerKind === "partner") return [];
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = (typeof row.companyName === "string" && row.companyName.trim())
      || (typeof row.name === "string" ? row.name.trim() : "");
    if (!id || !name) return [];
    const region = typeof row.region === "string" && row.region.trim() ? row.region.trim() : null;
    const founded = typeof row.foundedOn === "string" && row.foundedOn.trim() ? row.foundedOn.trim() : null;
    return [{
      id, name, region, founded_on: founded,
      display_status: typeof row.displayStatus === "string" ? row.displayStatus : null,
      contract_status: typeof row.contractStatus === "string" ? row.contractStatus : null,
      support_projects: Number.isFinite(Number(row.supportProjectCount)) ? Number(row.supportProjectCount) : 0,
    }];
  });
}

/**
 * **컨설팅 고객사**인가 — 지원사업 매칭 대상으로 볼 고객인가.
 *
 * 지금은 '최근 프로젝트가 있거나 지원사업 이력이 있으면' 이라 468곳 중 467곳이
 * 통과합니다. 그래서 화면에 고객사가 469곳 깔립니다.
 *
 * 실측(2026-10-30): 진행 중 10곳 · 지원사업 이력 8곳 · 둘을 합쳐 **12곳**.
 */
export function isConsultingCustomer(customer: WoolimworksCustomer) {
  return customer.display_status === "active"
    || customer.contract_status === "contracted"
    || customer.support_projects > 0;
}

/**
 * 매칭이 쓸 요건. **꺼 둔 것까지** 읽습니다.
 *
 * 꺼 둔 것을 빼고 읽으면 '아직 안 적은 고객사' 와 '사업자를 다 꺼서 대상이
 * 아닌 고객사' 를 구분할 수 없습니다. 둘은 다르게 다뤄야 합니다 —
 * 앞은 울림웍스 값으로라도 판정하고, 뒤는 대상에서 뺍니다.
 */
export async function listCustomerProfilesForMatching(admin: SupabaseClient): Promise<CustomerProfileRow[]> {
  const { data, error } = await admin.from(TABLE)
    .select("id,customer_id,entity_key,entity_name,business_number,profile,active,version,updated_by,updated_at")
    .order("customer_id").order("entity_key");
  if (error) throw new ProgramApiError(500, "CUSTOMER_PROFILES_READ_FAILED");
  return (data ?? []) as CustomerProfileRow[];
}

/** 매칭이 쓸 수 있게 켜져 있는 요건만 읽습니다. */
export async function listActiveCustomerProfiles(admin: SupabaseClient): Promise<CustomerProfileRow[]> {
  return (await listCustomerProfilesForMatching(admin)).filter((row) => row.active);
}

/**
 * 판정 대상을 가리키는 이름.
 *
 * 한 고객사에 사업자가 여럿이라 고객 id 만으로는 가릴 수 없습니다.
 * 요건을 적어 두지 않은 고객사는 예전처럼 고객 id 그대로 씁니다 —
 * 적어 두기 전과 후에 판정이 끊기지 않게 하려는 것입니다.
 */
export function entityTargetId(customerId: string, entityKey: string) {
  return `${customerId}:${entityKey}`;
}

/**
 * 화면에 보일 판정 대상 이름.
 * 사업자가 여럿이면 어느 사업자인지 보여야 합니다.
 */
export function entityTargetName(customerName: string, entityName: string, several: boolean) {
  return several ? `${customerName} · ${entityName}` : entityName;
}

/** 적어 둔 요건을 고객 id 로 묶습니다. */
export function groupByCustomer(rows: readonly CustomerProfileRow[]) {
  const out = new Map<string, CustomerProfileRow[]>();
  for (const row of rows) {
    const found = out.get(row.customer_id) ?? [];
    found.push(row);
    out.set(row.customer_id, found);
  }
  return out;
}
