import { readFile } from "node:fs/promises";
import { sha256, type PptxInspection } from "./pptx-inspection.ts";
import type { PreparationWorkStore } from "./work-store.ts";
import type { A4SourceFitInput } from "../../portfolio/a4-source-fit.ts";

export const SOURCE_FORMAT_CHOICE_VERSION = "local-source-format-1";
export type SourceFormatChoice = {
  kind: "custom_portrait_to_a4";
  aspectClass: "a4_portrait";
  sourceHash: string;
  reviewedBy: string;
  reason: string;
};
export type SourceFormatChoiceReceipt = SourceFormatChoice & {
  version: typeof SOURCE_FORMAT_CHOICE_VERSION;
  sourceWidth: number;
  sourceHeight: number;
  policy: "opaque-white-padding-no-resize-no-crop";
};

function fail(code: string): never { throw new Error(code); }
function note(value: unknown, max: number) {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail("SOURCE_FORMAT_REVIEW_REQUIRED");
  return value.trim();
}

/** The raw inspection is never reclassified. A choice grants only local fitting,
 * not permission to disclose an image, approve redaction, or publish a set. */
export function validateSourceFormatChoice(inspection: PptxInspection, choice?: SourceFormatChoice): SourceFormatChoiceReceipt | undefined {
  if (choice === undefined) return undefined;
  if (!choice || choice.kind !== "custom_portrait_to_a4" || choice.aspectClass !== "a4_portrait"
    || !/^[0-9a-f]{64}$/.test(choice.sourceHash) || choice.sourceHash !== inspection.sourceHash) fail("SOURCE_FORMAT_SOURCE_MISMATCH");
  if (inspection.aspect !== "unknown" || inspection.pageSizeVariant !== "custom"
    || !Number.isFinite(inspection.width) || !Number.isFinite(inspection.height)
    || inspection.width <= 0 || inspection.height <= inspection.width || inspection.height > 14400
    || Math.abs((inspection.width / inspection.height) / (1 / Math.SQRT2) - 1) > .03) fail("SOURCE_FORMAT_NOT_COMPATIBLE");
  return { version: SOURCE_FORMAT_CHOICE_VERSION, kind: choice.kind, aspectClass: choice.aspectClass,
    sourceHash: choice.sourceHash, reviewedBy: note(choice.reviewedBy, 100), reason: note(choice.reason, 500),
    sourceWidth: inspection.width, sourceHeight: inspection.height, policy: "opaque-white-padding-no-resize-no-crop" };
}

export const sourceFormatFingerprint = (receipt?: SourceFormatChoiceReceipt) => receipt ? sha256(JSON.stringify(receipt)) : undefined;

/** Derived input used only by selection/template lookup; do not persist it as the source inspection. */
export function sourceFormatSelectionInspection(inspection: PptxInspection, receipt?: SourceFormatChoiceReceipt): PptxInspection {
  if (!receipt) return inspection;
  const checked = validateSourceFormatChoice(inspection, receipt);
  if (JSON.stringify(checked) !== JSON.stringify(receipt)) fail("SOURCE_FORMAT_RECEIPT_MISMATCH");
  return { ...inspection, aspect: receipt.aspectClass,
    issues: inspection.issues.filter((issue) => issue.code !== "NO_APPROVED_SUITE") };
}

export async function readSourceFormatChoice(store: PreparationWorkStore, buildId: string, inspection: PptxInspection) {
  const build = await store.readBuild(buildId);
  if (!build.artifacts["source-format-choice"]) return undefined;
  const stage = await store.getReusableStage(buildId, "source_inspection");
  const artifact = await store.getReusableArtifact(buildId, "source-format-choice");
  if (!stage || !stage.artifactKeys.includes("source-format-choice") || !artifact) fail("SOURCE_FORMAT_RECEIPT_STALE");
  const bytes = await readFile(artifact.absolutePath);
  if (bytes.length > 4096 || sha256(bytes) !== artifact.record.sha256) fail("SOURCE_FORMAT_RECEIPT_STALE");
  let receipt: SourceFormatChoiceReceipt;
  try { receipt = JSON.parse(bytes.toString("utf8")); } catch { fail("SOURCE_FORMAT_RECEIPT_STALE"); }
  const checked = validateSourceFormatChoice(inspection, receipt);
  if (JSON.stringify(checked) !== JSON.stringify(receipt)) fail("SOURCE_FORMAT_RECEIPT_MISMATCH");
  if (build.fingerprint.source.sha256 !== receipt.sourceHash) fail("SOURCE_FORMAT_SOURCE_MISMATCH");
  return receipt;
}

export function sourceFormatA4Fit(inspection: PptxInspection, receipt?: SourceFormatChoiceReceipt): Omit<A4SourceFitInput, "buffer"> | undefined {
  if (receipt) {
    sourceFormatSelectionInspection(inspection, receipt);
    return { sourceWidth: inspection.width, sourceHeight: inspection.height,
      aspectClass: "a4_portrait", sourceKind: "custom_preview" };
  }
  if (inspection.pageSizeVariant !== "powerpoint_a4_preset_landscape") return undefined;
  if (inspection.aspect !== "a4_landscape" || inspection.slideSizeType !== "A4"
    || Math.abs(inspection.width - 780) > .00001 || Math.abs(inspection.height - 540) > .00001) fail("MOCKUP_SOURCE_FORMAT_MISMATCH");
  return { sourceWidth: inspection.width, sourceHeight: inspection.height,
    aspectClass: "a4_landscape", sourceKind: "powerpoint_a4_preset" };
}
