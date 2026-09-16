/** Local preparation evidence is not redaction approval or permission to upload. */
export type PreparationReviewBuild = { buildId: string; revision: number; sourceHash: string };
export type PreparationEvidenceImage = { imageHash: string; width: number; height: number };
export type PreparationReviewSlide = {
  sourceSlideNumber: number;
  slideContentHash: string;
  previewHash: string | null;
  evidence: PreparationEvidenceImage | null;
  artworkEligible: boolean;
  artworkReviewed: boolean;
  reasons: string[];
};
export type PreparationReviewView = PreparationReviewBuild & {
  version: 1;
  workId: string;
  source: { width: number; height: number; aspect: string; pageSizeVariant: string };
  customPortrait: {
    allowed: boolean;
    reviewSlideNumber: number | null;
    currentChoice: boolean;
    reason: string;
  };
  /** Includes the format-review source slide and only PHOTO_DENSE candidates.
   * Other exclusion categories never gain an override through this API. */
  slides: PreparationReviewSlide[];
  holds: string[];
  localOnly: true;
};
export type PreparationEvidenceRequest = {
  expectedCurrentBuild: PreparationReviewBuild;
  slideNumbers: number[];
};
export type PreparationEvidenceRead = {
  expectedCurrentBuild: PreparationReviewBuild;
  sourceSlideNumber: number;
  imageHash: string;
};
export type PreparationVisualDecision = {
  sourceSlideNumber: number;
  slideContentHash: string;
  previewHash: string;
  imageHash: string;
  inspectedAtActualSize: true;
  reason: string;
};
export type PreparationReviewApplyInput = {
  expectedCurrentBuild: PreparationReviewBuild;
  sourceFormatChoice?: PreparationVisualDecision & { kind: "custom_portrait_to_a4" };
  artworkReviews: (PreparationVisualDecision & { classification: "abstract_graphic" })[];
};
export type PreparationReviewApplyResult = { applied: true; buildId: string; launchUrl: string };
/** All callbacks are trusted worker closures. Browser payloads cannot select a
 * source path, actor, output directory or production destination. */
export type LocalPreparationReviewCallbacks = Readonly<{
  get: () => Promise<PreparationReviewView>;
  prepareEvidence: (input: PreparationEvidenceRequest) => Promise<PreparationReviewView>;
  readEvidence: (input: PreparationEvidenceRead) => Promise<Buffer>;
  apply: (input: PreparationReviewApplyInput) => Promise<PreparationReviewApplyResult>;
}>;
