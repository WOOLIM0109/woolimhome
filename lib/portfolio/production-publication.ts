import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePortfolioBodyHtml } from "../content-ops/portfolio-rules.ts";
import { REDACTION_RULE_VERSION } from "../pc-worker/preparation/redaction-types.ts";
import { activePortfolioImageSetId, resolvePortfolioImageSet } from "./image-set.ts";
import { portfolioThumbnailPointer } from "./thumbnail-version.ts";
import { validateProductionDescriptor, productionSetManifest } from "./production-descriptor.ts";
import { canonicalHash, isSha, isUuid, plainObject, MOCKUP_BRIDGE_VERSION } from "./production-session.ts";
import { loadProductionImageManifests, projectProductionPortfolioImages, type ProductionImageManifestRows } from "./production-image-projection.ts";

type PublicationItem = { id: string; format: string; metadata: unknown; content_review_assets: unknown };
export type ProductionPublicationEvidence = { session: unknown; currentSource: unknown };
function fail(code: string): never { throw new Error(code); }
const same = (a: unknown, b: unknown) => canonicalHash(a) === canonicalHash(b);
const indexes = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b);

/** A new-source equivalent of the legacy COM/job proof, NOT a bypass flag.
 * This function only accepts a service-role-read ACTIVATED worker session and
 * exact immutable set, plus the current download source binding. Browser
 * pointers alone cannot create proof. No bytes/text/state are changed here. */
export function validateVerifiedProductionPublication(
  item: PublicationItem, manifests: ProductionImageManifestRows, evidence: ProductionPublicationEvidence,
) {
  projectProductionPortfolioImages([item], manifests);
  const metadata = plainObject(item.metadata), set = resolvePortfolioImageSet(metadata, manifests.imageSets);
  if (!set) fail("MOCKUP_ACTIVE_SOURCE_PROOF_REQUIRED");
  const session = plainObject(evidence.session), binding = plainObject(session.binding);
  if (session.id !== set.setId || session.work_item_id !== item.id || session.status !== "activated"
    || session.source_hash !== set.sourceHash || !same(session.manifest, set)
    || !isUuid(session.candidate_id) || session.candidate_id !== metadata.candidateId
    || binding.workItemId !== item.id || binding.candidateId !== session.candidate_id
    || binding.version !== MOCKUP_BRIDGE_VERSION || !isSha(binding.sourceBindingHash)
    || !isSha(binding.expectedMetadataHash)) fail("MOCKUP_ACTIVE_SOURCE_PROOF_INVALID");
  const currentSource = plainObject(evidence.currentSource);
  if (!Object.keys(currentSource).length || canonicalHash(currentSource) !== binding.sourceBindingHash) fail("MOCKUP_PUBLICATION_SOURCE_CHANGED");
  const descriptor = validateProductionDescriptor(session.descriptor, session.descriptor_hash);
  const reconstructed = productionSetManifest(descriptor, item.id, set.setId, set.approval.approvedBy, set.approval.approvedAt);
  // Approval can record a later explicit visual inspection; the underlying
  // immutable manifest and its hash must still exactly match the worker proof.
  if (reconstructed.approval.manifestHash !== set.approval.manifestHash) fail("MOCKUP_ACTIVE_DESCRIPTOR_MISMATCH");
  const thumbnail = portfolioThumbnailPointer(metadata);
  if (thumbnail) {
    const version = manifests.thumbnailVersions.find(value => value.versionId === thumbnail.activeVersionId);
    if (!version || version.render.baseFingerprint !== descriptor.thumbnail.baseFingerprint) fail("MOCKUP_THUMBNAIL_BASE_PROOF_MISMATCH");
  }
  for (const board of descriptor.boards) {
    if (board.redactions.some(receipt => receipt.ruleVersion !== REDACTION_RULE_VERSION)) fail("MOCKUP_REDACTION_RULE_CHANGED");
  }
  const mockup = plainObject(metadata.portfolioMockup);
  const selected = mockup.selectedSlideIndexes;
  if (mockup.mode !== "short_psd" || mockup.bodyBoardCount !== 4 || mockup.redactionStatus !== "verified"
    || mockup.imageSetId !== set.setId || mockup.aspectClass !== set.aspectClass
    || mockup.templateSetId !== set.suiteId || mockup.templateVersion !== set.templateVersion
    || !Array.isArray(selected) || selected.some(n => !Number.isSafeInteger(n) || n < 0) || new Set(selected).size !== selected.length
    || !same(indexes(selected), indexes(set.assets.flatMap(asset => asset.slideIndexes)))) fail("MOCKUP_CURRENT_LAYOUT_PROOF_MISMATCH");
  // Every asset's approved template, source indices, dimensions and geometry
  // were validated above, including title provenance from the BASE thumbnail.
  // The title-only thumbnail manifest intentionally contains no BODY fields.
  const bodyHtml = plainObject(metadata.generated).bodyHtml;
  const html = typeof bodyHtml === "string" ? bodyHtml : "";
  const issues = validatePortfolioBodyHtml(html, { minimumFigures: 4 });
  const figures = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)];
  if (figures.length !== 4) issues.push("본문 figure 수가 확정 목업 4장과 일치하지 않습니다.");
  if (figures.some(figure => (figure[1].match(/<img[\s>]/gi) || []).length !== 1
    || !/<figcaption\b[^>]*>[\s\S]*?\S[\s\S]*?<\/figcaption>/i.test(figure[1]))) {
    issues.push("각 본문 목업 figure에는 이미지 1장과 설명이 함께 있어야 합니다.");
  }
  const imageTags = [...html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)];
  const imageUrls: string[] = [];
  for (const [tag] of imageTags) {
    const sources = [...tag.matchAll(/\ssrc\s*=\s*(["'])([\s\S]*?)\1/gi)];
    if (sources.length !== 1 || /\ssrcset\s*=/i.test(tag)) {
      issues.push("본문 이미지 주소가 모호하여 확정 이미지와 대조할 수 없습니다.");
      continue;
    }
    imageUrls.push(sources[0][2].replace(/&(?:amp|#38|#x26);/gi, "&"));
  }
  if (!same([...imageUrls].sort(), set.assets.slice(1).map(asset => asset.url).sort())) {
    issues.push("본문 이미지 URL이 현재 기밀 검수를 통과한 확정 목업 4장과 일치하지 않습니다.");
  }
  return [...new Set(issues)];
}

/** Called only from an authenticated single-item publication approval. Unlike
 * image-list projection this additionally rechecks the current source record.
 * Missing retained evidence fails closed; it never starts a job or an API call. */
export async function readVerifiedProductionPublicationIssues(item: PublicationItem, admin: Pick<SupabaseClient, "from">) {
  const setId = activePortfolioImageSetId(item.metadata);
  if (!setId) fail("MOCKUP_ACTIVE_SOURCE_PROOF_REQUIRED");
  const [manifests, sessionResult] = await Promise.all([
    loadProductionImageManifests([item], admin),
    admin.from("portfolio_mockup_sessions").select("id,work_item_id,candidate_id,status,binding,source_hash,descriptor_hash,descriptor,manifest")
      .eq("id", setId).eq("work_item_id", item.id).eq("status", "activated").maybeSingle(),
  ]);
  if (sessionResult.error || !sessionResult.data) fail("MOCKUP_ACTIVE_SOURCE_PROOF_REQUIRED");
  const session = sessionResult.data;
  if (!isUuid(session.candidate_id)) fail("MOCKUP_ACTIVE_SOURCE_PROOF_INVALID");
  const { data: downloads, error } = await admin.from("content_jobs").select("result")
    .eq("candidate_id", session.candidate_id).eq("job_type", "download").eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1);
  if (error || !downloads?.[0]) fail("MOCKUP_PUBLICATION_SOURCE_EVIDENCE_MISSING");
  return validateVerifiedProductionPublication(item, manifests, { session, currentSource: downloads[0].result });
}
