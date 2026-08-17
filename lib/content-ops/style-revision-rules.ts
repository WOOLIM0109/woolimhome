import { createHash } from "node:crypto";

/**
 * 이 값을 올리면 이미 정리해 둔 원고도 한 번 더 대상이 됩니다.
 * 말투 다듬기를 소제목 단위로 바꾸면서, 앞선 방식으로 넘어간 원고를 다시 훑기 위해 올렸습니다.
 */
export const FRIENDLY_STYLE_VERSION = "friendly-partner-v5-section-rewrite";

export const STYLE_REVISION_PENDING_STATUSES = [
  "review_required",
  "approved",
  "naver_ready",
  "scheduled",
] as const;

type RevisionGeneratedContent = {
  summary?: unknown;
  bodyHtml?: unknown;
  faq?: unknown;
  sourceUrls?: unknown;
};

type RevisionCandidate = {
  status?: unknown;
  published_at?: unknown;
  published_url?: unknown;
  published_url_normalized?: unknown;
  published_account?: unknown;
  metadata?: unknown;
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function styleRevisionFingerprint(generated: RevisionGeneratedContent) {
  const faq = Array.isArray(generated.faq)
    ? generated.faq.map((item) => {
      const entry = record(item);
      return {
        question: typeof entry.question === "string" ? entry.question : "",
        answer: typeof entry.answer === "string" ? entry.answer : "",
      };
    })
    : [];
  return createHash("sha256").update(JSON.stringify({
    summary: typeof generated.summary === "string" ? generated.summary : "",
    bodyHtml: typeof generated.bodyHtml === "string" ? generated.bodyHtml : "",
    faq,
    sourceUrls: Array.isArray(generated.sourceUrls)
      ? generated.sourceUrls.filter((value): value is string => typeof value === "string")
      : [],
  })).digest("hex");
}

export function createStyleRevisionStamp(
  generated: RevisionGeneratedContent,
  details: Record<string, unknown> = {},
) {
  return {
    ...details,
    version: FRIENDLY_STYLE_VERSION,
    fingerprint: styleRevisionFingerprint(generated),
  };
}

export function minimumStyleRevisionBodyLength(format: string, originalLength: number) {
  const absoluteMinimum = format === "portfolio" ? 1_600 : 1_800;
  return Math.min(
    originalLength,
    Math.max(absoluteMinimum, Math.floor(originalLength * 0.65)),
  );
}

export function hasPublicationEvidence(item: RevisionCandidate) {
  const metadata = record(item.metadata);
  const handoff = record(metadata.partnerHandoff);
  return item.status === "published"
    || nonEmptyString(item.published_at)
    || nonEmptyString(item.published_url)
    || nonEmptyString(item.published_url_normalized)
    || nonEmptyString(item.published_account)
    || nonEmptyString(handoff.completedAt)
    || nonEmptyString(handoff.publishedUrl);
}

export function shouldRewritePendingStyleItem(item: RevisionCandidate) {
  if (!STYLE_REVISION_PENDING_STATUSES.includes(
    item.status as (typeof STYLE_REVISION_PENDING_STATUSES)[number],
  )) return false;
  if (hasPublicationEvidence(item)) return false;

  const metadata = record(item.metadata);
  const generated = record(metadata.generated) as RevisionGeneratedContent;
  if (!nonEmptyString(generated.bodyHtml)) return false;

  const revision = record(metadata.styleRevision);
  const fingerprint = styleRevisionFingerprint(generated);
  if (revision.version !== FRIENDLY_STYLE_VERSION) return true;
  if (revision.fingerprint !== fingerprint) return true;
  // 말투 다듬기가 중간에 넘어간 원고는 다음 실행에서 다시 시도합니다.
  // 이 표시가 없으면 예전 방식으로 저장된 원고이므로 손대지 않습니다.
  return revision.styleComplete === false;
}
