import { createHash } from "node:crypto";
import sharp from "sharp";
import { activePortfolioImageSetId, portfolioImageSetAssetUrl } from "./image-set.ts";
import { normalizeThumbnailTitleSpec, type ThumbnailTitleSpec } from "./production-title-schema.ts";
import { assertFlatRedactionPng } from "../pc-worker/preparation/redaction-renderer.ts";

/** Server-side domain service, not a browser import / Server Action. The caller
 * must authenticate the actual administrator and verify the local render receipt
 * before constructing expectedProof. No environment, storage or network is read. */
export type ThumbnailRenderIdentity = {
  localWorkId: string; buildId: string; sourceHash: string;
  baseFingerprint: string; overlayFingerprint: string;
};
export type ThumbnailRenderProof = ThumbnailRenderIdentity & {
  inputFingerprint: string; titleSpec: ThumbnailTitleSpec;
};
export type PortfolioThumbnailVersion = {
  version: 1; versionId: string; workItemId: string; baselineId: string;
  baseSetId: string | null; baseFingerprint: string; render: ThumbnailRenderProof;
  asset: { kind: "thumbnail"; name: "thumbnail.png"; bucket: "portfolio-rendered";
    path: string; url: string; sha256: string; width: 1080; height: 1080; caption: string };
  approval: { approvedBy: string; approvedAt: string; outputInspected: true; manifestHash: string };
};
export type ThumbnailWorkItem = { id: string; format: string; updated_at: string;
  metadata: Record<string, unknown>; [key: string]: unknown };
export type ThumbnailVersionPointer = { version: 1; activeVersionId: string; baselineId: string;
  baseSetId: string | null; baseFingerprint: string; manifestHash: string; activatedBy: string; activatedAt: string };
export type ThumbnailVersionCommit = {
  workItemId: string; expectedUpdatedAt: string; expectedMetadata: Record<string, unknown>;
  expectedActiveVersionId: string | null; expectedActiveSetId: string | null;
  baseFingerprint: string; baselineId: string; operation: "activate" | "restore" | "restore_legacy";
  version: PortfolioThumbnailVersion | null; nextMetadata: Record<string, unknown>;
  nextThumbnail: Record<string, unknown>; actor: string; activatedAt: string;
};
/** commit MUST atomically change only the thumbnail review row, matching
 * portfolioAssets element and portfolioThumbnailVersion pointer/history.
 * BODY row IDs/URLs and all manuscript/publication fields remain untouched. */
export type PortfolioThumbnailVersionStore = {
  readWorkItem(id: string): Promise<ThumbnailWorkItem | null>;
  readVersion(workItemId: string, versionId: string): Promise<PortfolioThumbnailVersion | null>;
  readLegacyThumbnail(workItemId: string, baselineId: string): Promise<Record<string, unknown> | null>;
  commit(input: ThumbnailVersionCommit): Promise<{ workItemId: string; activeVersionId: string | null; updatedAt: string }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw new Error(code); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function exact(value: unknown, keys: string[]) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(object(value)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function text(value: unknown, max: number) { return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value); }
function date(value: unknown) { return typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
function identity(value: ThumbnailRenderIdentity) {
  if (![value.localWorkId,value.buildId].every(v => typeof v === "string" && UUID.test(v))
    || ![value.sourceHash,value.baseFingerprint,value.overlayFingerprint].every(v => typeof v === "string" && SHA.test(v))) fail("THUMBNAIL_RENDER_IDENTITY_INVALID");
  return { localWorkId: value.localWorkId, buildId: value.buildId, sourceHash: value.sourceHash,
    baseFingerprint: value.baseFingerprint, overlayFingerprint: value.overlayFingerprint };
}
function renderProof(value: ThumbnailRenderProof) {
  if (!exact(value, ["localWorkId","buildId","sourceHash","baseFingerprint","overlayFingerprint","inputFingerprint","titleSpec"])
    || !SHA.test(value.inputFingerprint)) fail("THUMBNAIL_RENDER_PROOF_INVALID");
  identity(value);
  if (!same(normalizeThumbnailTitleSpec(value.titleSpec), value.titleSpec)) fail("THUMBNAIL_TITLE_NOT_NORMALIZED");
}
export function portfolioThumbnailPointer(metadata: Record<string, unknown>): ThumbnailVersionPointer | null {
  const p = metadata.portfolioThumbnailVersion;
  if (p === undefined) return null;
  if (!exact(p, ["version","activeVersionId","baselineId","baseSetId","baseFingerprint","manifestHash","activatedBy","activatedAt"])) fail("THUMBNAIL_POINTER_INVALID");
  const value = p as ThumbnailVersionPointer;
  if (value.version !== 1 || ![value.activeVersionId,value.baselineId].every(v => UUID.test(v))
    || (value.baseSetId !== null && !UUID.test(value.baseSetId)) || !SHA.test(value.baseFingerprint)
    || !SHA.test(value.manifestHash) || !text(value.activatedBy,100) || !date(value.activatedAt)) fail("THUMBNAIL_POINTER_INVALID");
  return structuredClone(value);
}
function assetList(metadata: Record<string, unknown>) {
  const assets = metadata.portfolioAssets;
  if (!Array.isArray(assets) || assets.some(a => !a || typeof a !== "object" || Array.isArray(a))
    || assets.filter(a => object(a).kind === "thumbnail").length !== 1
    || !text(object(assets.find(a => object(a).kind === "thumbnail")).url,3000)) fail("THUMBNAIL_LEGACY_MAPPING_REQUIRED");
  return assets as Record<string, unknown>[];
}
function thumbnail(metadata: Record<string, unknown>) { return assetList(metadata).find(a => a.kind === "thumbnail")!; }
/** Excludes title images and article text so rollback rebases onto CURRENT
 * writing. BODY metadata, suite/source metadata and verified render identity
 * remain binding: source, slots, blur/renderer changes invalidate approval. */
export function portfolioThumbnailBaseFingerprint(snapshot: ThumbnailWorkItem, verifiedIdentity: ThumbnailRenderIdentity) {
  if (!UUID.test(snapshot.id) || snapshot.format !== "portfolio") fail("THUMBNAIL_WRONG_WORK_ITEM");
  return hash({ version: 1, workItemId: snapshot.id, baseSetId: activePortfolioImageSetId(snapshot.metadata),
    assets: assetList(snapshot.metadata).filter(a => a.kind !== "thumbnail"),
    portfolioMockup: snapshot.metadata.portfolioMockup ?? null,
    portfolioSource: snapshot.metadata.portfolioSource ?? null, renderIdentity: identity(verifiedIdentity) });
}
export function portfolioThumbnailManifestHash(value: Omit<PortfolioThumbnailVersion,"approval"> | PortfolioThumbnailVersion) {
  const { approval: _approval, ...manifest } = value as PortfolioThumbnailVersion; void _approval;
  return hash(manifest);
}
export function validatePortfolioThumbnailVersion(value: PortfolioThumbnailVersion) {
  if (!exact(value, ["version","versionId","workItemId","baselineId","baseSetId","baseFingerprint","render","asset","approval"])
    || value.version !== 1 || ![value.versionId,value.workItemId,value.baselineId].every(v => UUID.test(v))
    || (value.baseSetId !== null && !UUID.test(value.baseSetId)) || !SHA.test(value.baseFingerprint)) fail("THUMBNAIL_VERSION_INVALID");
  renderProof(value.render);
  const asset = value.asset, expectedPath = `verified-thumbnail/${value.workItemId}/${value.versionId}.png`;
  if (!exact(asset, ["kind","name","bucket","path","url","sha256","width","height","caption"])
    || asset.kind !== "thumbnail" || asset.name !== "thumbnail.png" || asset.bucket !== "portfolio-rendered"
    || asset.path !== expectedPath || asset.url !== portfolioImageSetAssetUrl(expectedPath)
    || !SHA.test(asset.sha256) || asset.width !== 1080 || asset.height !== 1080 || !text(asset.caption,500)) fail("THUMBNAIL_ASSET_INVALID");
  if (!exact(value.approval, ["approvedBy","approvedAt","outputInspected","manifestHash"])
    || !text(value.approval.approvedBy,100) || !date(value.approval.approvedAt) || value.approval.outputInspected !== true
    || value.approval.manifestHash !== portfolioThumbnailManifestHash(value)) fail("THUMBNAIL_APPROVAL_INVALID");
  return structuredClone(value);
}
/** Construct ONLY from a trusted verified renderer receipt and actual PNG.
 * This checks bytes, not the truth of browser-submitted approval JSON. Auth
 * actor and render proof must be derived by the server/local authenticated bridge. */
export async function createVerifiedPortfolioThumbnailVersion(snapshot: ThumbnailWorkItem, input: {
  versionId: string; render: ThumbnailRenderProof; png: Buffer; expectedImageHash: string;
  actor: string; approvedAt: string; outputInspected: true;
}) {
  renderProof(input.render);
  if (!Buffer.isBuffer(input.png) || input.png.length > 12 * 1024 * 1024
    || !SHA.test(input.expectedImageHash) || createHash("sha256").update(input.png).digest("hex") !== input.expectedImageHash) fail("THUMBNAIL_BYTES_MISMATCH");
  assertFlatRedactionPng(input.png);
  const dimensions = await sharp(input.png, { limitInputPixels: 2_000_000 }).metadata();
  if (dimensions.format !== "png" || dimensions.width !== 1080 || dimensions.height !== 1080) fail("THUMBNAIL_DIMENSIONS_INVALID");
  const p = portfolioThumbnailPointer(snapshot.metadata);
  const manifest = { version: 1 as const, versionId: input.versionId, workItemId: snapshot.id,
    baselineId: p?.baselineId ?? input.versionId, baseSetId: activePortfolioImageSetId(snapshot.metadata),
    baseFingerprint: portfolioThumbnailBaseFingerprint(snapshot,input.render), render: structuredClone(input.render),
    asset: { kind: "thumbnail" as const, name: "thumbnail.png" as const, bucket: "portfolio-rendered" as const,
      path: `verified-thumbnail/${snapshot.id}/${input.versionId}.png`,
      url: portfolioImageSetAssetUrl(`verified-thumbnail/${snapshot.id}/${input.versionId}.png`),
      sha256: input.expectedImageHash, width: 1080 as const, height: 1080 as const, caption: "확인한 썸네일 제목" } };
  return validatePortfolioThumbnailVersion({ ...manifest, approval: { approvedBy: input.actor, approvedAt: input.approvedAt,
    outputInspected: input.outputInspected, manifestHash: portfolioThumbnailManifestHash(manifest) } });
}
function assertCurrent(snapshot: ThumbnailWorkItem, input: { expectedUpdatedAt: string; expectedActiveVersionId: string | null; expectedActiveSetId: string | null }) {
  if (snapshot.updated_at !== input.expectedUpdatedAt || (portfolioThumbnailPointer(snapshot.metadata)?.activeVersionId ?? null) !== input.expectedActiveVersionId
    || activePortfolioImageSetId(snapshot.metadata) !== input.expectedActiveSetId) fail("THUMBNAIL_REVISION_CONFLICT");
}
function nextMetadata(snapshot: ThumbnailWorkItem, nextThumbnail: Record<string, unknown>, pointer: ThumbnailVersionPointer | null) {
  const next = { ...structuredClone(snapshot.metadata), portfolioAssets: assetList(snapshot.metadata).map(a => a.kind === "thumbnail" ? structuredClone(nextThumbnail) : structuredClone(a)) };
  if (pointer) (next as Record<string,unknown>).portfolioThumbnailVersion = pointer;
  else delete (next as Record<string,unknown>).portfolioThumbnailVersion;
  return next;
}
type CommitExpectations = { expectedUpdatedAt: string; expectedActiveVersionId: string | null; expectedActiveSetId: string | null; actor: string; activatedAt: string };
export function preparePortfolioThumbnailCommit(snapshot: ThumbnailWorkItem, input: CommitExpectations & {
  version: PortfolioThumbnailVersion; expectedProof: { render: ThumbnailRenderProof; sha256: string }; operation?: "activate" | "restore";
}): ThumbnailVersionCommit {
  const version = validatePortfolioThumbnailVersion(input.version);
  if (snapshot.id !== version.workItemId) fail("THUMBNAIL_WRONG_WORK_ITEM");
  assertCurrent(snapshot,input);
  if (!text(input.actor,100) || !date(input.activatedAt)) fail("THUMBNAIL_ACTOR_REQUIRED");
  if ((input.operation ?? "activate") === "activate" && version.approval.approvedBy !== input.actor) fail("THUMBNAIL_APPROVAL_ACTOR_MISMATCH");
  if (!same(version.render,input.expectedProof.render) || version.asset.sha256 !== input.expectedProof.sha256) fail("THUMBNAIL_REVIEW_STALE");
  const p = portfolioThumbnailPointer(snapshot.metadata), base = portfolioThumbnailBaseFingerprint(snapshot,input.expectedProof.render);
  if (base !== version.baseFingerprint || version.baseSetId !== input.expectedActiveSetId
    || (p && (p.baseFingerprint !== base || p.baseSetId !== input.expectedActiveSetId))
    || version.baselineId !== (p?.baselineId ?? version.versionId)) fail("THUMBNAIL_BASE_CHANGED");
  const pointer: ThumbnailVersionPointer = { version: 1, activeVersionId: version.versionId, baselineId: version.baselineId,
    baseSetId: version.baseSetId, baseFingerprint: base, manifestHash: version.approval.manifestHash,
    activatedBy: input.actor, activatedAt: input.activatedAt };
  return { workItemId: snapshot.id, expectedUpdatedAt: input.expectedUpdatedAt, expectedMetadata: structuredClone(snapshot.metadata),
    expectedActiveVersionId: input.expectedActiveVersionId, expectedActiveSetId: input.expectedActiveSetId,
    baseFingerprint: base, baselineId: version.baselineId, operation: input.operation ?? "activate", version,
    nextMetadata: nextMetadata(snapshot,version.asset,pointer), nextThumbnail: structuredClone(version.asset), actor: input.actor, activatedAt: input.activatedAt };
}
export async function activatePortfolioThumbnailVersion(input: Omit<Parameters<typeof preparePortfolioThumbnailCommit>[1],"activatedAt"|"operation"> & { workItemId: string },
  dependencies: { store: PortfolioThumbnailVersionStore; now?: () => Date }) {
  const version = validatePortfolioThumbnailVersion(input.version);
  if (!text(input.actor,100)) fail("THUMBNAIL_ACTOR_REQUIRED");
  if (input.workItemId !== version.workItemId) fail("THUMBNAIL_WRONG_WORK_ITEM");
  if (!same(version.render,input.expectedProof.render) || version.asset.sha256 !== input.expectedProof.sha256) fail("THUMBNAIL_REVIEW_STALE");
  const snapshot = await dependencies.store.readWorkItem(input.workItemId);
  if (!snapshot) fail("THUMBNAIL_WORK_ITEM_NOT_FOUND");
  const p = portfolioThumbnailPointer(snapshot.metadata);
  if (p?.activeVersionId === version.versionId) {
    const stored = await dependencies.store.readVersion(snapshot.id,version.versionId);
    if (!stored || !same(stored,version) || p.manifestHash !== version.approval.manifestHash
      || !same(thumbnail(snapshot.metadata),version.asset)) fail("THUMBNAIL_VERSION_ID_REUSED");
    if (portfolioThumbnailBaseFingerprint(snapshot,input.expectedProof.render) !== version.baseFingerprint) fail("THUMBNAIL_BASE_CHANGED");
    return { workItemId: snapshot.id, activeVersionId: version.versionId, updatedAt: snapshot.updated_at };
  }
  return dependencies.store.commit(preparePortfolioThumbnailCommit(snapshot,{ ...input, activatedAt: (dependencies.now?.() ?? new Date()).toISOString() }));
}
/** The authenticated boundary must verify the chosen immutable/legacy image
 * still exists before calling restore; this service never contacts storage. */
export async function restorePortfolioThumbnailVersion(input: CommitExpectations & {
  workItemId: string; restoreVersionId: string | null; baselineId: string; expectedRenderIdentity: ThumbnailRenderIdentity;
}, dependencies: { store: PortfolioThumbnailVersionStore }) {
  const snapshot = await dependencies.store.readWorkItem(input.workItemId);
  if (!snapshot) fail("THUMBNAIL_WORK_ITEM_NOT_FOUND");
  if (!text(input.actor,100) || !date(input.activatedAt) || !UUID.test(input.baselineId)) fail("THUMBNAIL_ACTOR_REQUIRED");
  const p = portfolioThumbnailPointer(snapshot.metadata), base = portfolioThumbnailBaseFingerprint(snapshot,input.expectedRenderIdentity);
  if (p && (p.baselineId !== input.baselineId || p.baseFingerprint !== base || p.baseSetId !== activePortfolioImageSetId(snapshot.metadata))) fail("THUMBNAIL_BASE_CHANGED");
  if (input.restoreVersionId) {
    const version = await dependencies.store.readVersion(snapshot.id,input.restoreVersionId);
    if (!version || version.baselineId !== input.baselineId) fail("THUMBNAIL_RESTORE_NOT_FOUND");
    validatePortfolioThumbnailVersion(version);
    if (version.workItemId !== snapshot.id) fail("THUMBNAIL_WRONG_WORK_ITEM");
    if (!same(identity(version.render),identity(input.expectedRenderIdentity)) || version.baseFingerprint !== base) fail("THUMBNAIL_BASE_CHANGED");
    if (p?.activeVersionId === version.versionId && same(thumbnail(snapshot.metadata),version.asset)) return { workItemId: snapshot.id, activeVersionId: version.versionId, updatedAt: snapshot.updated_at };
    return dependencies.store.commit(preparePortfolioThumbnailCommit(snapshot,{ ...input, version,
      expectedProof: { render: version.render, sha256: version.asset.sha256 }, operation: "restore" }));
  }
  const legacy = await dependencies.store.readLegacyThumbnail(snapshot.id,input.baselineId);
  if (!legacy || legacy.kind !== "thumbnail" || !text(legacy.url,3000)) fail("THUMBNAIL_RESTORE_NOT_FOUND");
  if (!p) {
    if (!same(thumbnail(snapshot.metadata),legacy) || activePortfolioImageSetId(snapshot.metadata) !== input.expectedActiveSetId) fail("THUMBNAIL_REVISION_CONFLICT");
    return { workItemId: snapshot.id, activeVersionId: null, updatedAt: snapshot.updated_at };
  }
  assertCurrent(snapshot,input);
  return dependencies.store.commit({ workItemId: snapshot.id, expectedUpdatedAt: input.expectedUpdatedAt,
    expectedMetadata: structuredClone(snapshot.metadata), expectedActiveVersionId: input.expectedActiveVersionId, expectedActiveSetId: input.expectedActiveSetId,
    baseFingerprint: base, baselineId: input.baselineId, operation: "restore_legacy", version: null,
    nextMetadata: nextMetadata(snapshot,legacy,null), nextThumbnail: structuredClone(legacy), actor: input.actor, activatedAt: input.activatedAt });
}
