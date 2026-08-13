export const LOCAL_REDACTION_WORKER_CAPABILITY = "powerpoint_selective_redaction_manifest_v2";
/**
 * 이 버전 이상으로 변환한 결과만 최신으로 봅니다.
 *
 * 2.6.0 에서 '작은 글씨' 기준을 18pt 에서 11pt 로 내렸습니다.
 * 그 전에 변환한 기록에는 본문 글자까지 작은 글씨로 적혀 있어,
 * 목업만 다시 만들면 예전 기준이 그대로 남습니다.
 * 기준을 올려 두면 예전 기록으로 만든 작업은 원본부터 다시 변환합니다.
 *
 * 2.7.0 에서는 장표의 공개용 제목까지 함께 보냅니다.
 * 그 글자가 없으면 서버가 문서 주제를 몰라 일반론만 쓴 글이 나옵니다.
 *
 * 2.8.0 에서는 표지의 전체 배경 그림을 버리지 않고 그대로 씁니다.
 * 그 전에는 표지가 통째로 변환에서 빠져 대표 썸네일을 만들지 못했습니다.
 */
export const MIN_LOCAL_REDACTION_WORKER_VERSION = "2.8.0";

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
