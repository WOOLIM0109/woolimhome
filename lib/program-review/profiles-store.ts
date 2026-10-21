import type { SupabaseClient } from "@supabase/supabase-js";
import { ProgramApiError } from "./agent-auth.ts";

export const SELF_PROFILE_IDS = ["woolim-company", "cellavento"] as const;
export const PROFILE_FIELDS = ["region", "founded_on", "business_type", "industries", "employees", "revenue_krw", "revenue_band",
  "certifications", "certifications_complete", "has_support_history", "notes"] as const;
export type ApprovedSelfProfile = { id: string; name: string; aliases: string[]; profile: Record<string, unknown>; version: number; updated_at: string };

export function profileKey(value: string) {
  if (!(SELF_PROFILE_IDS as readonly string[]).includes(value)) throw new ProgramApiError(404, "PROFILE_NOT_FOUND");
  return value;
}
export function strictKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ProgramApiError(400, "UNKNOWN_FIELD");
}
export function boundedText(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\u0000")) throw new ProgramApiError(400, "INVALID_FIELD");
  return value.trim();
}
export function stringList(value: unknown, maximum = 100, itemLength = 1000): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new ProgramApiError(400, "INVALID_FIELD");
  return value.map(item => boundedText(item, itemLength) as string);
}
export function validateProfilePatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) throw new ProgramApiError(400, "INVALID_PATCH");
  const patch = value as Record<string, unknown>; strictKeys(patch, PROFILE_FIELDS);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(patch)) {
    if (["certifications_complete", "has_support_history"].includes(key)) {
      if (typeof item !== "boolean") throw new ProgramApiError(400, "INVALID_FIELD");
      result[key] = item;
    } else if (item === null) result[key] = null;
    else if (["industries", "certifications"].includes(key)) result[key] = stringList(item, 100, 200);
    else if (["employees", "revenue_krw"].includes(key)) {
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) throw new ProgramApiError(400, "INVALID_FIELD");
      result[key] = item;
    } else if (key === "founded_on") {
      if (typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item)
        || !Number.isFinite(Date.parse(item)) || new Date(item).toISOString().slice(0, 10) !== item) throw new ProgramApiError(400, "INVALID_FIELD");
      result[key] = item;
    } else result[key] = boundedText(item, key === "notes" ? 4000 : 200);
  }
  return result;
}

export async function readApprovedSelfProfiles(admin: SupabaseClient): Promise<ApprovedSelfProfile[]> {
  const { data, error } = await admin.from("openchat_program_self_profiles")
    .select("id,name,aliases,profile,version,updated_at").in("id", [...SELF_PROFILE_IDS]).order("id");
  if (error || !data || data.length !== 2) throw new ProgramApiError(503, "PROFILES_UNAVAILABLE");
  return data.map(row => ({ id: row.id, name: row.name, aliases: row.aliases,
    profile: Object.fromEntries(PROFILE_FIELDS.map(key => [key, row.profile?.[key] ?? null])), version: row.version, updated_at: row.updated_at }));
}

/** Called only after cookie administrator authentication by the admin route. */
export async function applySelfProfileProposal(admin: SupabaseClient, proposalId: string, expectedVersion: number, actor: string, approve: boolean) {
  const { data, error } = await admin.rpc("apply_openchat_program_profile_proposal", {
    p_proposal_id: proposalId, p_expected_version: expectedVersion, p_actor: actor, p_approve: approve,
  });
  if (error) throw new ProgramApiError(error.code === "40001" || error.code === "P0001" ? 409 : 500, "PROPOSAL_CONFLICT");
  return data;
}
