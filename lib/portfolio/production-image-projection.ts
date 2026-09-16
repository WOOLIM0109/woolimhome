import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activePortfolioImageSetId, resolvePortfolioImageSet, type VerifiedPortfolioImageSet,
} from "./image-set.ts";
import {
  portfolioThumbnailPointer, portfolioThumbnailBaseFingerprint,
  validatePortfolioThumbnailVersion, type PortfolioThumbnailVersion,
} from "./thumbnail-version.ts";

type Item = {
  id?: unknown; format?: unknown; metadata?: unknown; content_review_assets?: unknown;
};
export type ProductionImageManifestRows = {
  imageSets: readonly VerifiedPortfolioImageSet[];
  thumbnailVersions: readonly PortfolioThumbnailVersion[];
};
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(object(value)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const isImage = (kind: unknown) => kind === "thumbnail" || kind === "body_image";
function fail(code: string): never { throw new Error(code); }

/** Presence, not validity, controls precedence. A damaged pointer must NEVER
 * re-enable legacy hardcoded mockups or destructive legacy image writers. */
export function hasProductionPortfolioImageSelection(metadata: unknown) {
  const value = object(metadata);
  return Object.hasOwn(value, "portfolioImageSet") || Object.hasOwn(value, "portfolioThumbnailVersion");
}

/** Call before legacy uploads, conversions, queue resets or image deletion.
 * The explicit verified-set/title activation paths are the only writers for
 * these selections; even a discard-manual-assets option cannot bypass this. */
export function assertLegacyPortfolioImageWriteAllowed(metadata: unknown) {
  if (hasProductionPortfolioImageSelection(metadata)) fail("IMAGE_SET_LEGACY_WRITE_BLOCKED");
}

function selection(item: Item) {
  const metadata = object(item.metadata);
  if (!hasProductionPortfolioImageSelection(metadata)) return null;
  if (typeof item.id !== "string" || item.format !== "portfolio") fail("IMAGE_SET_WRONG_WORK_ITEM");
  const setId = activePortfolioImageSetId(metadata), thumbnail = portfolioThumbnailPointer(metadata);
  if (Object.hasOwn(metadata, "portfolioImageSet") && !setId) fail("IMAGE_SET_ACTIVE_POINTER_INVALID");
  if (Object.hasOwn(metadata, "portfolioThumbnailVersion") && !thumbnail) fail("THUMBNAIL_POINTER_INVALID");
  return { metadata, setId, thumbnail };
}

/** Gather once for the entire result page. No database access for legacy-only
 * pages, and at most one batched query per immutable manifest table. */
export async function loadProductionImageManifests(items: readonly Item[], admin: Pick<SupabaseClient, "from">): Promise<ProductionImageManifestRows> {
  const selections = items.map(selection);
  const setIds = [...new Set(selections.flatMap(s => s?.setId ? [s.setId] : []))];
  const versionIds = [...new Set(selections.flatMap(s => s?.thumbnail ? [s.thumbnail.activeVersionId] : []))];
  const empty = { data: [], error: null };
  const [sets, versions] = await Promise.all([
    setIds.length ? admin.from("portfolio_image_sets").select("id,work_item_id,manifest").in("id", setIds) : empty,
    versionIds.length ? admin.from("portfolio_thumbnail_versions").select("id,work_item_id,manifest").in("id", versionIds) : empty,
  ]);
  if (sets.error || versions.error) fail("IMAGE_SET_MANIFEST_READ_FAILED");
  const imageSets = (sets.data || []).map(row => {
    const manifest = object(row.manifest);
    if (row.id !== manifest.setId || row.work_item_id !== manifest.workItemId) fail("IMAGE_SET_MANIFEST_ROW_MISMATCH");
    return row.manifest as VerifiedPortfolioImageSet;
  });
  const thumbnailVersions = (versions.data || []).map(row => {
    const manifest = object(row.manifest);
    if (row.id !== manifest.versionId || row.work_item_id !== manifest.workItemId) fail("THUMBNAIL_MANIFEST_ROW_MISMATCH");
    return row.manifest as PortfolioThumbnailVersion;
  });
  return { imageSets, thumbnailVersions };
}

/** A read-only projection shared by admin, review and partner lists. Only real
 * review-row IDs are retained: the existing authenticated partner URL helper
 * then resolves the same verified images without synthetic IDs or public URLs.
 * Text, FAQ, publication state and non-image attachments are never rewritten. */
export function projectProductionPortfolioImages<T extends Item>(items: readonly T[], manifests: ProductionImageManifestRows): T[] {
  return items.map(item => {
    const current = selection(item);
    if (!current) return item;
    const { metadata, setId, thumbnail: pointer } = current;
    if (setId && manifests.imageSets.filter(set => set.setId === setId).length !== 1) fail("IMAGE_SET_ACTIVE_SET_MISSING");
    const set = resolvePortfolioImageSet(metadata, manifests.imageSets);
    if (set && set.workItemId !== item.id) fail("IMAGE_SET_WRONG_WORK_ITEM");
    const storedAssets = metadata.portfolioAssets;
    if (!Array.isArray(storedAssets) || storedAssets.some(a => !a || typeof a !== "object" || Array.isArray(a))) fail("IMAGE_SET_METADATA_ASSETS_MISMATCH");
    let titleVersion: PortfolioThumbnailVersion | null = null;
    if (pointer) {
      const versions = manifests.thumbnailVersions.filter(v => v.versionId === pointer.activeVersionId);
      if (versions.length !== 1) fail("THUMBNAIL_ACTIVE_VERSION_MISSING");
      titleVersion = validatePortfolioThumbnailVersion(versions[0]);
      if (titleVersion.workItemId !== item.id || titleVersion.baseSetId !== setId
        || pointer.baseSetId !== setId || pointer.baselineId !== titleVersion.baselineId
        || pointer.manifestHash !== titleVersion.approval.manifestHash
        || pointer.baseFingerprint !== titleVersion.baseFingerprint) fail("THUMBNAIL_ACTIVE_VERSION_MISMATCH");
      if (set && (titleVersion.render.localWorkId !== set.localWorkId || titleVersion.render.buildId !== set.buildId
        || titleVersion.render.sourceHash !== set.sourceHash)) fail("THUMBNAIL_BASE_CHANGED");
      const baseFingerprint = portfolioThumbnailBaseFingerprint({ id: String(item.id), format: "portfolio", updated_at: "", metadata }, titleVersion.render);
      if (baseFingerprint !== titleVersion.baseFingerprint) fail("THUMBNAIL_BASE_CHANGED");
    }
    // A title version replaces exactly the thumbnail. All four BODY manifests
    // still have to match the approved full set byte-for-byte as metadata.
    const expectedImages = set ? set.assets.map(asset => asset.kind === "thumbnail" && titleVersion ? titleVersion.asset : asset)
      : storedAssets.filter(asset => isImage(object(asset).kind));
    if (!same(storedAssets.filter(asset => isImage(object(asset).kind)), expectedImages)) fail("IMAGE_SET_METADATA_ASSETS_MISMATCH");
    if (titleVersion && (storedAssets.filter(a => object(a).kind === "thumbnail").length !== 1
      || !same(storedAssets.find(a => object(a).kind === "thumbnail"), titleVersion.asset))) fail("THUMBNAIL_METADATA_ASSET_MISMATCH");

    const rows = Array.isArray(item.content_review_assets) ? item.content_review_assets : [];
    const preserved = rows.filter(row => !isImage(object(row).asset_type));
    const projected = expectedImages.map((asset, index) => {
      const matches = rows.filter(row => object(row).asset_type === object(asset).kind && object(row).public_url === object(asset).url);
      if (matches.length !== 1) fail("IMAGE_SET_REVIEW_ASSET_MISSING");
      const row = object(matches[0]);
      if (typeof row.id !== "string" || !row.id || (row.work_item_id !== undefined && row.work_item_id !== item.id)) fail("IMAGE_SET_REVIEW_ASSET_INVALID");
      return { ...row, id: row.id, sort_order: index };
    });
    if (new Set(projected.map(row => row.id)).size !== projected.length) fail("IMAGE_SET_REVIEW_ASSET_INVALID");
    return { ...item, content_review_assets: [...projected, ...preserved] };
  });
}

/** Never include database messages, URLs, private metadata or supplied values
 * in a projection failure response. A stale pointer does not trigger fallback. */
export function productionImageProjectionErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return /^(?:IMAGE_SET|THUMBNAIL)_[A-Z_]+$/.test(code) ? code : "IMAGE_SET_PROJECTION_INVALID";
}
