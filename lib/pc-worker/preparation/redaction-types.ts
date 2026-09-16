/** Local-only contracts. Never put extracted text or source paths in these records. */
export const REDACTION_RULE_VERSION = "local-redaction-2";
export type RedactionRect = { x: number; y: number; width: number; height: number };
export type RedactionCandidate = {
  id: string; rect: RedactionRect; category: string; required: boolean; reason: string;
};
/** Located geometry uncertainty only. Missing text/objects remain fatal warnings. */
export type RedactionUncertainty = {
  id: string; candidateId: string; rect: RedactionRect;
  code: "TEXT_RENDER_BOUNDS_UNRESOLVED" | "TEXT_GEOMETRY_UNRESOLVED" | "IMAGE_GEOMETRY_UNRESOLVED";
};
export type RedactionDetection = {
  sourceSlideNumber: number; sourceHash: string; slideContentHash: string;
  candidates: RedactionCandidate[]; warnings: string[];
  uncertainties?: RedactionUncertainty[];
};
export type RedactionRegion = {
  id: string; candidateId?: string; rect: RedactionRect; mode: "opaque" | "blur";
};
export type RedactionException = { candidateId: string; actor: string; reason: string };
export type RedactionReview = {
  reviewer: string; originalInspected: boolean; layoutAcceptable: boolean;
};
/** One explicit local inspection, bound to the actual source and exact edit draft. */
export type RedactionManualResolution = {
  uncertaintyId: string; decision: "opaque_confirmed" | "non_sensitive_confirmed";
  actor: string; reason: string; inspectedAtActualSize: true; reviewedRevision: number;
  sourceHash: string; slideContentHash: string; imageHash: string;
  uncertaintyHash: string; editHash: string; regionId?: string;
};
export type RedactionOutput = {
  artifactKey: string; sha256: string; width: number; height: number;
  inputFingerprint: string; createdAt: string;
  checks: { outsidePreserved: true; requiredOpaque: true; metadataStripped: true };
  approvedAt: string | null; approvedBy: string | null;
};
export type RedactionState = {
  version: 1; ruleVersion: string; workId: string; buildId: string;
  sourceSlideNumber: number; sourceHash: string; slideContentHash: string;
  imageHash: string; width: number; height: number; revision: number;
  candidates: RedactionCandidate[]; warnings: string[];
  uncertainties?: RedactionUncertainty[]; manualResolutions?: RedactionManualResolution[];
  regions: RedactionRegion[]; exceptions: RedactionException[]; review: RedactionReview;
  status: "editing" | "needs_review" | "rendered" | "verified" | "replacement_required";
  output: RedactionOutput | null;
};
