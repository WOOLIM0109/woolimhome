import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioImageSetSnapshot, PortfolioImageSetStore, VerifiedPortfolioImageSet } from "./image-set.ts";

/** Dependency injection only: importing this adapter reads no environment,
 * creates no client and starts no network request. Do not invoke against
 * production before the migration and import/approval boundary are deployed. */
export function createSupabasePortfolioImageSetStore(admin: SupabaseClient): PortfolioImageSetStore {
  return {
    async readWorkItem(id) {
      const { data, error } = await admin.from("content_work_items").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error("IMAGE_SET_READ_FAILED");
      return data as PortfolioImageSetSnapshot | null;
    },
    async readImageSet(workItemId, setId) {
      const { data, error } = await admin.from("portfolio_image_sets").select("manifest")
        .eq("id", setId).eq("work_item_id", workItemId).maybeSingle();
      if (error) throw new Error("IMAGE_SET_HISTORY_READ_FAILED");
      return data?.manifest as VerifiedPortfolioImageSet | null;
    },
    async commit(input) {
      const { data, error } = await admin.rpc("activate_portfolio_image_set", {
        p_work_item_id: input.workItemId, p_expected_updated_at: input.expectedUpdatedAt,
        p_expected_active_set_id: input.expectedActiveSetId, p_expected_metadata: input.expectedMetadata,
        p_next_metadata: input.nextMetadata, p_manifest: input.set, p_operation: input.operation,
        p_actor: input.activatedBy, p_activated_at: input.activatedAt,
      });
      if (error) {
        const code = error.message.match(/IMAGE_SET_[A-Z_]+/)?.[0];
        throw new Error(code || "IMAGE_SET_COMMIT_FAILED");
      }
      if (!data || data.workItemId !== input.workItemId || data.activeSetId !== input.set.setId
        || typeof data.updatedAt !== "string") throw new Error("IMAGE_SET_COMMIT_RECEIPT_INVALID");
      return { workItemId: data.workItemId, activeSetId: data.activeSetId, updatedAt: data.updatedAt };
    },
  };
}
