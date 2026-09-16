import sharp from "sharp";
import { withVerifiedLocalMockupSet } from "./mockup-service.ts";
import type { MockupIdentity } from "./mockup-types.ts";
import type { LocalMockupSetSnapshot } from "./mockup-handoff-types.ts";
import { assertFlatRedactionPng, redactionHash } from "./redaction-renderer.ts";
import { portfolioImageSetManifestHash, portfolioImageSetAssetUrl, validatePortfolioImageSet,
  preparePortfolioImageSetCommit, type VerifiedPortfolioImageSet, type PortfolioImageSetStore } from "../../portfolio/image-set.ts";

export type MockupHandoffDestination = { workItemId: string; setId: string };
/** Explicit private storage adapter. No default fetch/client/env is imported.
 * putImmutable must not overwrite an existing object, and get must read back
 * its actual bytes. The deploy-time adapter needs bounded request timeouts. */
export type MockupHandoffStorage = {
  get(bucket: "portfolio-rendered", path: string): Promise<Buffer | null>;
  putImmutable(bucket: "portfolio-rendered", path: string, png: Buffer): Promise<void>;
};
function fail(code: string): never { throw new Error(code); }
function manifest(snapshot: LocalMockupSetSnapshot, destination: MockupHandoffDestination) {
  return { version: 1 as const, ...destination, localWorkId: snapshot.localWorkId,
    buildId: snapshot.buildId, sourceHash: snapshot.sourceHash, assignmentHash: snapshot.assignmentHash,
    suiteId: snapshot.suiteId, templateVersion: snapshot.templateVersion, aspectClass: snapshot.aspectClass,
    assets: snapshot.boards.map((board, i) => {
      const objectPath = `verified-local/${destination.workItemId}/${destination.setId}/${i}.png`;
      return { kind: board.kind, name: i === 0 ? "thumbnail.png" : `body-${i}.png`,
        bucket: "portfolio-rendered" as const, path: objectPath, url: portfolioImageSetAssetUrl(objectPath),
        sha256: board.imageHash, width: board.width, height: board.height, caption: "승인된 목업 이미지",
        slideIndexes: board.sourceSlideNumbers.map(n => n - 1), slideAspectRatio: board.slideAspectRatio,
        mockupMode: "short_psd" as const, aspectClass: snapshot.aspectClass,
        mockupTemplateId: board.templateId, mockupTemplateVersion: board.templateVersion };
    }) };
}
/** Only identifiers, dimensions and hashes are returned for an explicit review
 * prompt. This is not publication authorization and does not write a record. */
export async function previewLocalMockupHandoff(input: MockupIdentity & MockupHandoffDestination) {
  return withVerifiedLocalMockupSet(input, async snapshot => {
    const value = manifest(snapshot, { workItemId: input.workItemId, setId: input.setId });
    return { manifest: value, approvalHash: portfolioImageSetManifestHash(value),
      visualReview: "not_performed" as const, activeSetUnchanged: true as const };
  });
}
async function verifyStoredPng(bytes: Buffer | null, expected: VerifiedPortfolioImageSet["assets"][number]) {
  if (!bytes || bytes.length > 12 * 1024 * 1024 || redactionHash(bytes) !== expected.sha256) fail("HANDOFF_STORED_HASH_MISMATCH");
  assertFlatRedactionPng(bytes);
  const image = await sharp(bytes, { limitInputPixels: 2_000_000 }).metadata();
  if (image.format !== "png" || image.width !== expected.width || image.height !== expected.height) fail("HANDOFF_STORED_IMAGE_INVALID");
}
/** Trusted local bridge, not a public import endpoint. A future HTTP boundary
 * must authenticate the actual approver/worker; client JSON claims alone are
 * not proof of approval. Tests inject private memory storage and a transaction
 * store. No retry, live client, queue or AI invocation is provided here. */
export async function handoffLocalMockupSet(input: MockupIdentity & MockupHandoffDestination & {
  expectedApprovalHash: string; approvedBy: string; outputInspected: boolean;
  expectedUpdatedAt: string; expectedActiveSetId: string | null;
}, dependencies: { storage: MockupHandoffStorage; store: PortfolioImageSetStore; now?: () => Date }) {
  if (!input.outputInspected || !input.approvedBy?.trim()) fail("HANDOFF_EXPLICIT_OUTPUT_REVIEW_REQUIRED");
  return withVerifiedLocalMockupSet(input, async snapshot => {
    const value = manifest(snapshot, { workItemId: input.workItemId, setId: input.setId });
    const hash = portfolioImageSetManifestHash(value);
    if (hash !== input.expectedApprovalHash) fail("HANDOFF_APPROVAL_STALE");
    const timestamp = (dependencies.now?.() ?? new Date()).toISOString();
    const set: VerifiedPortfolioImageSet = { ...value, approval: { approvedBy: input.approvedBy,
      approvedAt: timestamp, outputInspected: true, manifestHash: hash, visualReview: "not_performed" } };
    validatePortfolioImageSet(set);
    if (snapshot.boards.some(board => board.png.length > 12 * 1024 * 1024)) fail("HANDOFF_IMAGE_TOO_LARGE");
    const current = await dependencies.store.readWorkItem(input.workItemId);
    if (!current) fail("IMAGE_SET_WORK_ITEM_NOT_FOUND");
    // Validate body URL mapping and optimistic concurrency BEFORE uploading.
    const commit = preparePortfolioImageSetCommit(current, { set, expectedUpdatedAt: input.expectedUpdatedAt,
      expectedActiveSetId: input.expectedActiveSetId, actor: input.approvedBy, activatedAt: timestamp });
    let reused = 0;
    for (const [i, asset] of set.assets.entries()) {
      const cached = await dependencies.storage.get(asset.bucket, asset.path);
      if (cached) { await verifyStoredPng(cached, asset); reused++; }
      else {
        await dependencies.storage.putImmutable(asset.bucket, asset.path, Buffer.from(snapshot.boards[i].png));
        await verifyStoredPng(await dependencies.storage.get(asset.bucket, asset.path), asset);
      }
    }
    // One atomic commit, after every immutable image is read-back verified.
    // Failure leaves the old active set and manuscript intact. Private staged
    // files are retained for explicit retry, never deleted speculatively.
    const result = await dependencies.store.commit(commit);
    return { ...result, manifestHash: hash, images: set.assets.length, reused, visualReview: "not_performed" as const };
  });
}
