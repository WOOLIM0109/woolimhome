import type { A4SourceFitReceipt } from "../../portfolio/a4-source-fit.ts";

export const LOCAL_MOCKUP_VERSION = "local-mockup-2";
export type MockupIdentity = { root: string; buildId: string };
export type MockupReceipt = {
  sourceSlideNumber: number; imageHash: string; redactionFingerprint: string;
  ruleVersion: string; approvedAt: string;
  /** Source redaction imageHash above remains unchanged. Fit is a derived render input only. */
  sourceFit?: A4SourceFitReceipt;
};
export type MockupSlot = { slotId: string; sourceSlideNumber: number | null; receipt: MockupReceipt | null };
export type MockupImageRecord = {
  sha256: string; artifactKey: string; debugArtifactKey: string; debugHash: string;
  manifestArtifactKey: string; manifestHash: string;
  inputFingerprint: string; renderFingerprint: string; scale: .5 | 1;
  width: number; height: number; createdAt: string;
};
export type MockupBoard = {
  templateId: string; geometryHash: string; slots: MockupSlot[];
  draft: MockupImageRecord | null; final: MockupImageRecord | null;
};
export type MockupPreparationRequest = {
  id: string; sourceSlideNumber: number; reason: string; createdAt: string;
};
export type LocalMockupState = {
  version: typeof LOCAL_MOCKUP_VERSION; workId: string; buildId: string;
  sourceHash: string; aspectClass: string; suiteId: string; templateVersion: string;
  sourceFormatFingerprint?: string;
  revision: number; title: string; boards: MockupBoard[]; requests: MockupPreparationRequest[];
};
export type MockupCandidate = {
  sourceSlideNumber: number; title: string;
  status: "approved" | "needs_redaction" | "needs_preparation";
  imageHash?: string; reason?: string;
};
export type MockupBoardReview = {
  templateId: string; label: string;
  slots: { slotId: string; position: number; role: string; sourceSlideNumber: number | null }[];
  holds: string[]; draft: MockupImageRecord | null; final: MockupImageRecord | null;
};
export type LocalMockupReview = {
  workId: string; buildId: string; aspectClass: string; minimum: number;
  sourceFitNotice?: string;
  revision: number | null; title: string; state: { initialized: true } | null;
  candidates: MockupCandidate[]; boards: MockupBoardReview[];
  requests: (MockupPreparationRequest & { status: "pending" | "ready" })[];
  visualReview: "not_performed"; activeSetUnchanged: true;
};
