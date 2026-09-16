import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioThumbnailVersion, PortfolioThumbnailVersionStore, ThumbnailWorkItem } from "./thumbnail-version.ts";

/** Explicit dependency injection only. Importing this adapter does not load
 * credentials, instantiate a client, download assets or invoke an RPC. */
export function createSupabasePortfolioThumbnailVersionStore(admin: SupabaseClient): PortfolioThumbnailVersionStore {
  return {
    async readWorkItem(id) {
      const { data,error } = await admin.from("content_work_items").select("*").eq("id",id).maybeSingle();
      if (error) throw new Error("THUMBNAIL_READ_FAILED");
      return data as ThumbnailWorkItem | null;
    },
    async readVersion(workItemId,versionId) {
      const { data,error } = await admin.from("portfolio_thumbnail_versions").select("manifest")
        .eq("id",versionId).eq("work_item_id",workItemId).maybeSingle();
      if (error) throw new Error("THUMBNAIL_HISTORY_READ_FAILED");
      return (data?.manifest ?? null) as PortfolioThumbnailVersion | null;
    },
    async readLegacyThumbnail(workItemId,baselineId) {
      const { data,error } = await admin.from("portfolio_thumbnail_version_activations").select("previous_thumbnail")
        .eq("work_item_id",workItemId).eq("baseline_id",baselineId).is("previous_version_id",null)
        .order("created_at",{ ascending: true }).order("id",{ ascending: true }).limit(1).maybeSingle();
      if (error) throw new Error("THUMBNAIL_HISTORY_READ_FAILED");
      return (data?.previous_thumbnail ?? null) as Record<string,unknown> | null;
    },
    async commit(input) {
      const { data,error } = await admin.rpc("activate_portfolio_thumbnail_version",{
        p_work_item_id: input.workItemId, p_expected_updated_at: input.expectedUpdatedAt,
        p_expected_active_version_id: input.expectedActiveVersionId, p_expected_active_set_id: input.expectedActiveSetId,
        p_expected_metadata: input.expectedMetadata, p_next_metadata: input.nextMetadata, p_manifest: input.version,
        p_next_thumbnail: input.nextThumbnail, p_baseline_id: input.baselineId, p_base_fingerprint: input.baseFingerprint,
        p_operation: input.operation, p_actor: input.actor, p_activated_at: input.activatedAt,
      });
      if (error) throw new Error(error.message.match(/THUMBNAIL_[A-Z_]+/)?.[0] || "THUMBNAIL_COMMIT_FAILED");
      const expected = input.operation === "restore_legacy" ? null : input.version?.versionId;
      if (!data || data.workItemId !== input.workItemId || data.activeVersionId !== expected || typeof data.updatedAt !== "string") {
        throw new Error("THUMBNAIL_COMMIT_RECEIPT_INVALID");
      }
      return { workItemId: data.workItemId, activeVersionId: data.activeVersionId, updatedAt: data.updatedAt };
    },
  };
}
