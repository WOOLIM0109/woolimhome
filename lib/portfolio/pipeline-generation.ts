export function createPortfolioGenerationId(input: {
  jobId: string;
  completedAt: string;
  sourceFingerprint: string;
}) {
  return `${input.jobId}:${input.completedAt}:${input.sourceFingerprint}`;
}

export function ownsPortfolioGeneration(
  metadataValue: unknown,
  generationId: string,
  sourceFingerprint: string,
  ruleVersion: string,
) {
  if (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue)) return false;
  const metadata = metadataValue as Record<string, unknown>;
  return metadata.portfolioGenerationId === generationId
    && metadata.portfolioSourceFingerprint === sourceFingerprint
    && metadata.portfolioRuleVersion === ruleVersion;
}

export type PortfolioTerminalHoldOwner = {
  generationId?: string | null;
  conversionGenerationId?: string | null;
};

/**
 * Terminal side effects may only follow the pipeline generation that produced
 * the terminal source job. Legacy rows have no generation token, so they are
 * considered owned only while the current work item is also still unversioned.
 */
export function ownsPortfolioTerminalHold(
  metadataValue: unknown,
  owner: PortfolioTerminalHoldOwner,
) {
  if (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue)) {
    return false;
  }
  const metadata = metadataValue as Record<string, unknown>;
  const generationId = typeof owner.generationId === "string" && owner.generationId
    ? owner.generationId
    : null;
  const conversionGenerationId = typeof owner.conversionGenerationId === "string"
    && owner.conversionGenerationId
    ? owner.conversionGenerationId
    : null;
  if (generationId && metadata.portfolioGenerationId !== generationId) return false;
  if (conversionGenerationId
    && metadata.portfolioConversionGenerationId !== conversionGenerationId) return false;
  if (generationId || conversionGenerationId) return true;
  return typeof metadata.portfolioGenerationId !== "string"
    && typeof metadata.portfolioConversionGenerationId !== "string";
}
