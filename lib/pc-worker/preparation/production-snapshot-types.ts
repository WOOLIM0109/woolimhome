import type { A4SourceFitReceipt } from "../../portfolio/a4-source-fit.ts";
import type { ThumbnailTitleSpec } from "../../portfolio/thumbnail-title-overlay.ts";

export const PRODUCTION_MOCKUP_SNAPSHOT_VERSION = "verified-production-mockup-snapshot-v1" as const;
export type ProductionMockupSnapshotMode = "full" | "thumbnail";
export type ProductionSnapshotRedactionReceipt = Readonly<{
  slotId: string;
  sourceSlideNumber: number;
  imageHash: string;
  redactionFingerprint: string;
  ruleVersion: string;
  approvedAt: string;
  sourceFit?: A4SourceFitReceipt;
}>;
export type ProductionSnapshotBoardDescriptor = Readonly<{
  templateId: string;
  templateVersion: string;
  kind: "thumbnail" | "body_image";
  imageHash: string;
  width: number;
  height: number;
  slideAspectRatio: number;
  sourceSlideNumbers: readonly number[];
  geometryHash: string;
  rendererFingerprint: string;
  assignmentFingerprint: string;
  redactions: readonly ProductionSnapshotRedactionReceipt[];
}>;
/** Whitelisted transport description: no source path/text, debug images or privacy exceptions. */
export type ProductionMockupDescriptor = Readonly<{
  version: typeof PRODUCTION_MOCKUP_SNAPSHOT_VERSION;
  mode: ProductionMockupSnapshotMode;
  localWorkId: string;
  buildId: string;
  sourceHash: string;
  aspectClass: string;
  suiteId: string;
  templateVersion: string;
  sourceFormatFingerprint: string | null;
  assignmentHash: string;
  localRevision: number;
  titleRevision: number | null;
  remoteApproval: "required";
  localConfirmation: "technical_candidate_only";
  boards: readonly ProductionSnapshotBoardDescriptor[];
  thumbnail: Readonly<{
    templateId: string;
    baseImageHash: string;
    baseFingerprint: string;
    overlayFingerprint: string | null;
    titleSpec: ThumbnailTitleSpec | null;
    titleImageHash: string;
    localConfirmed: boolean;
  }>;
}>;
export type ProductionMockupPreview = Readonly<{
  descriptor: ProductionMockupDescriptor;
  /** Mode, identities, revisions, receipts and all output hashes are included. */
  snapshotHash: string;
}>;
export type ProductionMockupSnapshot = Readonly<ProductionMockupPreview & {
  boards: readonly (ProductionSnapshotBoardDescriptor & { png: Buffer })[];
  /** Only an approved-redaction composite, never a raw source slide. */
  titlelessBasePng: Buffer;
}>;
