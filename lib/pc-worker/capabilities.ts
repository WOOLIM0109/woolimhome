export const LOCAL_REDACTION_WORKER_CAPABILITY = "powerpoint_selective_redaction_manifest_v2";
export const MIN_LOCAL_REDACTION_WORKER_VERSION = "2.5.0";

function numericVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1, 4).map(Number) as [number, number, number];
}

function versionAtLeast(value: unknown, minimum: string) {
  const current = numericVersion(value);
  const required = numericVersion(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

export function isCurrentLocalRedactionWorkerVersion(value: unknown) {
  return versionAtLeast(value, MIN_LOCAL_REDACTION_WORKER_VERSION);
}

export function supportsLocalRedactionClaims(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as { workerVersion?: unknown; capabilities?: unknown };
  return isCurrentLocalRedactionWorkerVersion(claim.workerVersion)
    && Array.isArray(claim.capabilities)
    && claim.capabilities.includes(LOCAL_REDACTION_WORKER_CAPABILITY);
}
