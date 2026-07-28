export const MAX_AUTOMATED_SOURCE_BYTES = 75 * 1024 * 1024;

export function exceedsAutomatedSourceLimit(fileSize: number | null | undefined) {
  return Number(fileSize || 0) > MAX_AUTOMATED_SOURCE_BYTES;
}
