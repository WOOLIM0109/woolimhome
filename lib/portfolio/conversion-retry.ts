export type PortfolioConversionRecoveryState =
  | "ready"
  | "active"
  | "retryable"
  | "unavailable";

export function portfolioConversionRecoveryState(input: {
  status?: string | null;
  result?: { bucket?: unknown; slidePaths?: unknown } | null;
  errorMessage?: string | null;
}): PortfolioConversionRecoveryState {
  if (
    input.status === "completed"
    && typeof input.result?.bucket === "string"
    && Array.isArray(input.result.slidePaths)
    && input.result.slidePaths.length > 0
  ) return "ready";

  if (input.status === "pc_waiting" || input.status === "pc_running") return "active";
  if (
    input.status === "failed"
    && /(PC worker retry limit reached|INSUFFICIENT_USABLE_SLIDES|SHAPE_GEOMETRY_INSPECTION_FAILED)/i.test(input.errorMessage || "")
  ) return "retryable";
  return "unavailable";
}

export function isCompletePortfolioSourceDownload(result: unknown) {
  if (!result || typeof result !== "object") return false;
  const source = result as Record<string, unknown>;
  if (typeof source.originalFileName !== "string" || !source.originalFileName.trim()) {
    return false;
  }
  if (source.delivery === "pc_direct") {
    return typeof source.driveFileId === "string" && Boolean(source.driveFileId.trim());
  }
  return typeof source.bucket === "string"
    && Boolean(source.bucket.trim())
    && typeof source.storagePath === "string"
    && Boolean(source.storagePath.trim());
}
