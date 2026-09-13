import { createHash } from "node:crypto";
import { getRegisteredApprovedMockupSuite, approvedMockupSuiteTemplates } from "./approved-mockup-suites.ts";
import { resolveApprovedMockupSlots } from "./approved-16x9-templates.ts";
import { FRIENDLY_STYLE_VERSION, styleRevisionFingerprint } from "../content-ops/style-revision-rules.ts";

export const PORTFOLIO_IMAGE_SET_VERSION = 1 as const;
export type PortfolioImageSetAsset = {
  kind: "thumbnail" | "body_image"; name: string; bucket: "portfolio-rendered"; path: string; url: string;
  sha256: string; width: number; height: number; caption: string; slideIndexes: number[];
  slideAspectRatio: number; mockupMode: "short_psd"; aspectClass: string;
  mockupTemplateId: string; mockupTemplateVersion: string;
};
export type VerifiedPortfolioImageSet = {
  version: 1; setId: string; workItemId: string; localWorkId: string; buildId: string;
  sourceHash: string; assignmentHash: string; suiteId: string; templateVersion: string; aspectClass: string;
  assets: PortfolioImageSetAsset[];
  approval: { approvedBy: string; approvedAt: string; manifestHash: string; outputInspected: true;
    visualReview: "passed" | "not_performed"; visualReviewer?: string; visualReviewedAt?: string };
};
export type PortfolioImageSetSnapshot = {
  id: string; format: string; updated_at: string; metadata: Record<string, unknown>;
  [key: string]: unknown;
};
export type PortfolioImageSetCommit = {
  workItemId: string; expectedUpdatedAt: string; expectedActiveSetId: string | null;
  expectedMetadata: Record<string, unknown>; nextMetadata: Record<string, unknown>;
  set: VerifiedPortfolioImageSet; operation: "activate" | "restore"; activatedBy: string; activatedAt: string;
};
/** The implementation MUST commit the work-item metadata, image rows and set
 * history atomically, or change none of them. Production uses the SQL RPC in
 * the matching migration; tests use a transactional in-memory adapter. */
export type PortfolioImageSetStore = {
  readWorkItem(id: string): Promise<PortfolioImageSetSnapshot | null>;
  readImageSet(workItemId: string, setId: string): Promise<VerifiedPortfolioImageSet | null>;
  commit(input: PortfolioImageSetCommit): Promise<{ workItemId: string; activeSetId: string; updatedAt: string }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
function fail(code: string): never { throw new Error(code); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
function date(value: unknown) { return typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
function onlyKeys(value: unknown, keys: readonly string[]) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function portfolioImageSetManifestHash(set: Omit<VerifiedPortfolioImageSet, "approval"> | VerifiedPortfolioImageSet) {
  const { approval: _approval, ...manifest } = set as VerifiedPortfolioImageSet;
  void _approval;
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}
export function portfolioImageSetAssetUrl(objectPath: string) {
  return `/api/admin/assets?bucket=portfolio-rendered&path=${encodeURIComponent(objectPath)}`;
}
/** Input is a server-verified import receipt, never a user-submitted URL list.
 * This validates its structure/binding, not whether arbitrary client claims of
 * local approval are truthful. The import boundary verifies package hashes and
 * authenticated approval before invoking this service. No upload occurs here. */
export function validatePortfolioImageSet(set: VerifiedPortfolioImageSet) {
  if (!onlyKeys(set, ["version","setId","workItemId","localWorkId","buildId","sourceHash","assignmentHash","suiteId","templateVersion","aspectClass","assets","approval"])
    || set.version !== 1 || ![set.setId,set.workItemId,set.localWorkId,set.buildId].every(v => UUID.test(v))
    || !SHA.test(set.sourceHash) || !SHA.test(set.assignmentHash)) fail("IMAGE_SET_INVALID_IDENTITY");
  const suite = getRegisteredApprovedMockupSuite(set.aspectClass);
  if (!suite || suite.suiteId !== set.suiteId || suite.version !== set.templateVersion) fail("IMAGE_SET_TEMPLATE_UNAPPROVED");
  const templates = approvedMockupSuiteTemplates(suite);
  if (!Array.isArray(set.assets) || set.assets.length !== 5) fail("IMAGE_SET_INCOMPLETE");
  const hashes = new Set<string>();
  for (const [index, asset] of set.assets.entries()) {
    const template = templates[index], name = index === 0 ? "thumbnail.png" : `body-${index}.png`;
    const expectedPath = `verified-local/${set.workItemId}/${set.setId}/${index}.png`;
    if (!onlyKeys(asset, ["kind","name","bucket","path","url","sha256","width","height","caption","slideIndexes","slideAspectRatio","mockupMode","aspectClass","mockupTemplateId","mockupTemplateVersion"])
      || asset.kind !== (index === 0 ? "thumbnail" : "body_image") || asset.name !== name
      || asset.bucket !== "portfolio-rendered" || asset.path !== expectedPath || asset.url !== portfolioImageSetAssetUrl(expectedPath)
      || !SHA.test(asset.sha256) || hashes.has(asset.sha256) || asset.width !== template.canvas.width || asset.height !== template.canvas.height
      || asset.mockupTemplateId !== template.id || asset.mockupTemplateVersion !== template.version || asset.aspectClass !== suite.aspectClass
      || asset.mockupMode !== "short_psd" || asset.slideAspectRatio !== template.slideAspectRatio
      || typeof asset.caption !== "string" || asset.caption.length > 500 || /[\x00-\x1f]/.test(asset.caption)
      || !Array.isArray(asset.slideIndexes) || asset.slideIndexes.length !== resolveApprovedMockupSlots(template).length
      || asset.slideIndexes.some(n => !Number.isSafeInteger(n) || n < 0) || new Set(asset.slideIndexes).size !== asset.slideIndexes.length) fail("IMAGE_SET_INVALID_ASSET");
    hashes.add(asset.sha256);
  }
  const approval = set.approval;
  if (!onlyKeys(approval, ["approvedBy","approvedAt","manifestHash","outputInspected","visualReview","visualReviewer","visualReviewedAt"])
    || approval.outputInspected !== true || !text(approval.approvedBy, 100) || !date(approval.approvedAt)
    || approval.manifestHash !== portfolioImageSetManifestHash(set)
    || !["passed", "not_performed"].includes(approval.visualReview)
    || (approval.visualReview === "passed" && (!text(approval.visualReviewer, 100) || !date(approval.visualReviewedAt)))) fail("IMAGE_SET_APPROVAL_REQUIRED");
  return structuredClone(set);
}
export function activePortfolioImageSetId(metadata: unknown): string | null {
  const value = object(object(metadata).portfolioImageSet).activeSetId;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) fail("IMAGE_SET_ACTIVE_POINTER_INVALID");
  return value;
}
const imageTag = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const imageSource = /(\s+src\s*=\s*)(["'])([\s\S]*?)\2/gi;
function decodedAttribute(value: string) { return value.replace(/&(?:amp|#38|#x26);/gi, "&"); }
function encodedAttribute(value: string) { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
/** Strict replacement: exactly four known portfolio image sources, no reflow,
 * no generic image replacement, no caption/body rewriting and no new figure.
 * Legacy 3/5-image manuscripts need an explicitly approved placement migration. */
export function swapImageSetBodySources(bodyHtml: string, previous: readonly string[], next: readonly string[]) {
  if (typeof bodyHtml !== "string" || !bodyHtml.trim() || previous.length !== 4 || next.length !== 4
    || previous.some(url => !text(url, 3000)) || new Set(previous).size !== 4) fail("IMAGE_SET_BODY_MAPPING_REQUIRED");
  const counts = previous.map(() => 0);
  const result = bodyHtml.replace(imageTag, tag => {
    const sources = [...tag.matchAll(new RegExp(imageSource.source, "gi"))];
    const matches = sources.filter(match => previous.includes(decodedAttribute(match[3])));
    if (!matches.length) return tag;
    if (sources.length !== 1 || /\ssrcset\s*=/i.test(tag)) fail("IMAGE_SET_BODY_MAPPING_AMBIGUOUS");
    const source = matches[0], index = previous.indexOf(decodedAttribute(source[3]));
    counts[index]++;
    return tag.slice(0, source.index) + source[1] + source[2] + encodedAttribute(next[index]) + source[2] + tag.slice(source.index! + source[0].length);
  });
  if (counts.some(count => count !== 1)) fail("IMAGE_SET_BODY_MAPPING_REQUIRED");
  return result;
}
function currentBodyUrls(metadata: Record<string, unknown>) {
  const assets = metadata.portfolioAssets;
  if (!Array.isArray(assets)) fail("IMAGE_SET_BODY_MAPPING_REQUIRED");
  return assets.filter(a => object(a).kind === "body_image").map(a => {
    const url = object(a).url;
    if (typeof url !== "string") fail("IMAGE_SET_BODY_MAPPING_REQUIRED");
    return url;
  });
}
export function preparePortfolioImageSetCommit(snapshot: PortfolioImageSetSnapshot, input: {
  set: VerifiedPortfolioImageSet; expectedUpdatedAt: string; expectedActiveSetId: string | null;
  actor: string; activatedAt: string; operation?: "activate" | "restore";
}): PortfolioImageSetCommit {
  const set = validatePortfolioImageSet(input.set);
  if (snapshot.id !== set.workItemId || snapshot.format !== "portfolio") fail("IMAGE_SET_WRONG_WORK_ITEM");
  if (!text(input.actor, 100) || !date(input.activatedAt)) fail("IMAGE_SET_ACTOR_REQUIRED");
  const metadata = object(snapshot.metadata), previousSetId = activePortfolioImageSetId(metadata);
  if (snapshot.updated_at !== input.expectedUpdatedAt || previousSetId !== input.expectedActiveSetId) fail("IMAGE_SET_REVISION_CONFLICT");
  const generated = object(metadata.generated);
  if (typeof generated.bodyHtml !== "string") fail("IMAGE_SET_BODY_REQUIRED");
  const bodyHtml = swapImageSetBodySources(generated.bodyHtml, currentBodyUrls(metadata), set.assets.slice(1).map(a => a.url));
  const nextGenerated = { ...generated, bodyHtml };
  const style = object(metadata.styleRevision);
  // Carry only an existing matching stamp; never certify stale or incomplete
  // editorial work, and never import an AI module or enqueue an AI operation.
  const nextStyle = style.version === FRIENDLY_STYLE_VERSION && style.fingerprint === styleRevisionFingerprint(generated)
    ? { ...style, fingerprint: styleRevisionFingerprint(nextGenerated) } : style;
  const nextMetadata: Record<string, unknown> = {
    ...metadata, generated: nextGenerated,
    portfolioAssets: set.assets,
    portfolioImageSet: { version: 1, activeSetId: set.setId, previousSetId, manifestHash: set.approval.manifestHash,
      activatedAt: input.activatedAt, activatedBy: input.actor, operation: input.operation ?? "activate" },
    portfolioMockup: { ...object(metadata.portfolioMockup), mode: "short_psd", bodyBoardCount: 4, aspectClass: set.aspectClass,
      templateSetId: set.suiteId, templateVersion: set.templateVersion, redactionStatus: "verified",
      selectedSlideIndexes: [...new Set(set.assets.flatMap(a => a.slideIndexes))], imageSetId: set.setId },
    manualMockupOverride: { ...object(metadata.manualMockupOverride), kind: "verified_image_set", approvedAt: set.approval.approvedAt,
      approvedBy: set.approval.approvedBy, imageSetId: set.setId },
    ...(metadata.styleRevision !== undefined ? { styleRevision: nextStyle } : {}),
  };
  // A title edit is bound to one immutable base set. A new complete set starts
  // its own title history; never carry an old-base thumbnail pointer forward.
  delete nextMetadata.portfolioThumbnailVersion;
  return { workItemId: snapshot.id, expectedUpdatedAt: input.expectedUpdatedAt, expectedActiveSetId: input.expectedActiveSetId,
    expectedMetadata: structuredClone(metadata), nextMetadata, set, operation: input.operation ?? "activate", activatedBy: input.actor, activatedAt: input.activatedAt };
}
export async function activatePortfolioImageSet(input: {
  workItemId: string; set: VerifiedPortfolioImageSet; expectedUpdatedAt: string; expectedActiveSetId: string | null; actor: string;
}, dependencies: { store: PortfolioImageSetStore; now?: () => Date }) {
  if (input.workItemId !== input.set.workItemId) fail("IMAGE_SET_WRONG_WORK_ITEM");
  const snapshot = await dependencies.store.readWorkItem(input.workItemId);
  if (!snapshot) fail("IMAGE_SET_WORK_ITEM_NOT_FOUND");
  if (activePortfolioImageSetId(snapshot.metadata) === input.set.setId) {
    validatePortfolioImageSet(input.set);
    const stored = await dependencies.store.readImageSet(input.workItemId, input.set.setId);
    if (!stored || canonical(stored) !== canonical(input.set)) fail("IMAGE_SET_ID_REUSED");
    // A lost response followed by the same immutable operation is a no-op.
    // Do not overwrite text edited after the first successful activation.
    return { workItemId: snapshot.id, activeSetId: input.set.setId, updatedAt: snapshot.updated_at };
  }
  const commit = preparePortfolioImageSetCommit(snapshot, { ...input, activatedAt: (dependencies.now?.() ?? new Date()).toISOString() });
  return dependencies.store.commit(commit);
}
export async function restorePortfolioImageSet(input: {
  workItemId: string; restoreSetId: string; expectedUpdatedAt: string; expectedActiveSetId: string | null; actor: string;
}, dependencies: { store: PortfolioImageSetStore; now?: () => Date }) {
  const [snapshot, set] = await Promise.all([dependencies.store.readWorkItem(input.workItemId), dependencies.store.readImageSet(input.workItemId, input.restoreSetId)]);
  if (!snapshot || !set) fail("IMAGE_SET_RESTORE_NOT_FOUND");
  if (activePortfolioImageSetId(snapshot.metadata) === set.setId) {
    validatePortfolioImageSet(set);
    return { workItemId: snapshot.id, activeSetId: set.setId, updatedAt: snapshot.updated_at };
  }
  // Rebase image URLs onto the CURRENT manuscript. Never restore an old copy
  // of its text, FAQ, publication URL/status or unrelated metadata.
  return dependencies.store.commit(preparePortfolioImageSetCommit(snapshot, { ...input, set, operation: "restore",
    activatedAt: (dependencies.now?.() ?? new Date()).toISOString() }));
}
/** All admin/review/partner projections must use this same immutable set when
 * a pointer exists, ahead of legacy hardcoded manual overrides. Missing set
 * data is an error, never permission to fall back to stale legacy images. */
export function resolvePortfolioImageSet(metadata: Record<string, unknown>, sets: readonly VerifiedPortfolioImageSet[]) {
  const id = activePortfolioImageSetId(metadata);
  if (!id) return null;
  const set = sets.find(s => s.setId === id);
  if (!set || set.approval.manifestHash !== object(metadata.portfolioImageSet).manifestHash) fail("IMAGE_SET_ACTIVE_SET_MISSING");
  return validatePortfolioImageSet(set);
}
