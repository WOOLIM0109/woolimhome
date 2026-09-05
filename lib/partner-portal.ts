import { editorialPublicationIssues } from "./content-ops/editorial-policy.ts";
import type { WorkflowStatus } from "@/lib/content-ops/types";
import type { NaverPublicationChannel } from "@/lib/publication";

export const PARTNER_CHANNELS: NaverPublicationChannel[] = ["naver_consulting", "naver_design"];
export const PARTNER_VISIBLE_STATUSES: WorkflowStatus[] = [
  "approved",
  "naver_ready",
  "scheduled",
  "published",
];
export const PARTNER_FORCE_APPROVAL_MEMO_MAX_LENGTH = 2_000;

export function isPartnerChannel(value: unknown): value is NaverPublicationChannel {
  return typeof value === "string" && PARTNER_CHANNELS.includes(value as NaverPublicationChannel);
}

export function isPartnerVisibleStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && PARTNER_VISIBLE_STATUSES.includes(value as WorkflowStatus);
}

export function normalizePartnerForceApprovalMemo(value: unknown) {
  if (typeof value !== "string") return null;
  const memo = value.trim();
  if (!memo || memo.length > PARTNER_FORCE_APPROVAL_MEMO_MAX_LENGTH) return null;
  return memo;
}

export function isPartnerReleaseReady(item: {
  format: string;
  status: string;
  metadata?: {
    novelty?: { duplicate?: boolean };
    validation?: { issues?: string[] };
    partnerReleaseOverride?: { approvedAt?: string };
  } | null;
}) {
  if (!isPartnerVisibleStatus(item.status)) return false;
  if (item.status === "published" || item.format === "portfolio") return true;
  if (item.metadata?.partnerReleaseOverride?.approvedAt) return true;

  return item.metadata?.novelty?.duplicate === false
    && Array.isArray(item.metadata?.validation?.issues)
    && item.metadata.validation.issues.length === 0;
}

/**
 * 외주 작업실에 보이지 않는 이유
 *
 * 지금까지는 승인한 작업이 조건에 걸리면 아무 표시 없이 목록에서 빠졌습니다.
 * 관리자 화면에는 "승인 완료"라고 떠 있는데 외주 작업실에는 없는 상태가 되어,
 * 어디가 막힌 것인지 확인할 방법이 없었습니다.
 *
 * 이 함수 하나가 외주 노출 판단을 전담합니다.
 * 외주 화면은 이 결과로 거르고, 관리자 화면은 같은 결과를 사유로 보여 줍니다.
 * 두 화면이 같은 답을 쓰므로 한쪽만 아는 상태가 생기지 않습니다.
 */
export type PartnerVisibilityBlocker = {
  code: "channel" | "status" | "novelty" | "validation" | "editorial";
  message: string;
};

type PartnerVisibilityInput = {
  channel?: string;
  format: string;
  status: string;
  metadata?: {
    generated?: { bodyHtml?: unknown; faq?: unknown; sourceUrls?: unknown } | null;
    novelty?: { duplicate?: boolean };
    validation?: { issues?: string[] };
    partnerReleaseOverride?: { approvedAt?: string };
  } | null;
};

/**
 * 외주 작업실에 원고를 노출할 때 적용할 문체 검사입니다.
 * 관리자가 "이 상태 그대로 외주 작업실에 전달"을 선택했다면 그 결정은
 * 외주 작업실 노출에서도 동일하게 존중해야 합니다.
 */
export function partnerEditorialPublicationIssues(item: Pick<PartnerVisibilityInput, "format" | "metadata">) {
  if (item.metadata?.partnerReleaseOverride?.approvedAt) return [];
  return editorialPublicationIssues(item.format, item.metadata?.generated);
}

export function partnerVisibilityBlockers(item: PartnerVisibilityInput): PartnerVisibilityBlocker[] {
  const blockers: PartnerVisibilityBlocker[] = [];

  if (item.channel !== undefined && !isPartnerChannel(item.channel)) {
    blockers.push({ code: "channel", message: "네이버 채널 작업이 아니라 외주 작업실 대상이 아닙니다." });
    return blockers;
  }
  if (!isPartnerVisibleStatus(item.status)) {
    blockers.push({ code: "status", message: "아직 승인 전입니다. 승인하면 외주 작업실에 나타납니다." });
    return blockers;
  }
  // 이미 발행한 작업은 기록 확인용으로 항상 보여 줍니다.
  if (item.status === "published") return blockers;
  // 관리자가 이 원고 그대로 보내겠다고 정한 경우에는 더 막지 않습니다.
  if (item.metadata?.partnerReleaseOverride?.approvedAt) return blockers;

  if (item.format !== "portfolio") {
    if (item.metadata?.novelty?.duplicate !== false) {
      blockers.push({ code: "novelty", message: "중복 주제 검사를 통과한 기록이 없습니다." });
    }
    const validationIssues = item.metadata?.validation?.issues;
    if (!Array.isArray(validationIssues)) {
      blockers.push({ code: "validation", message: "본문 구조 검사를 통과한 기록이 없습니다." });
    } else {
      for (const issue of validationIssues) {
        blockers.push({ code: "validation", message: issue });
      }
    }
  }

  for (const issue of partnerEditorialPublicationIssues(item)) {
    blockers.push({ code: "editorial", message: issue });
  }

  return blockers;
}

export function isVisibleToPartner(item: PartnerVisibilityInput) {
  return partnerVisibilityBlockers(item).length === 0;
}

export function shouldGenerateScheduledItem(item: {
  format: string;
  status: string;
  metadata?: {
    pendingRevision?: { note?: unknown };
    novelty?: { duplicate?: boolean };
    validation?: { issues?: string[] };
    partnerReleaseOverride?: { approvedAt?: string };
  } | null;
}) {
  if (item.status === "topic_candidate") return true;
  if (item.status !== "approved" || item.format === "portfolio") return false;

  const hasPendingRevision = typeof item.metadata?.pendingRevision?.note === "string"
    && Boolean(item.metadata.pendingRevision.note.trim());
  return hasPendingRevision || !isPartnerReleaseReady(item);
}

export function partnerAssetUrl(id: string, download = false) {
  return `/api/partner/assets?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
}

export function replaceAdminAssetUrls(
  html: string,
  assets: { id: string; public_url: string }[],
) {
  return assets.reduce((result, asset) => {
    const replacement = partnerAssetUrl(asset.id);
    return result
      .split(asset.public_url)
      .join(replacement)
      .split(asset.public_url.replaceAll("&", "&amp;"))
      .join(replacement.replaceAll("&", "&amp;"));
  }, html);
}

export function replaceFiguresWithMarkers(html: string) {
  let bodyImageNumber = 0;
  return html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, (figure) => {
    bodyImageNumber += 1;
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim();
    const captionText = caption ? ` — ${caption}` : "";
    return `<p><strong>[본문 이미지 ${bodyImageNumber} 삽입${captionText}]</strong></p>`;
  });
}

export function parseStoredAssetUrl(publicUrl: string) {
  const parsed = new URL(publicUrl, "https://woolim-site.vercel.app");
  if (parsed.pathname !== "/api/admin/assets") return null;

  const bucket = parsed.searchParams.get("bucket");
  const path = parsed.searchParams.get("path");
  if (bucket !== "portfolio-rendered" || !path || path.includes("..")) return null;

  return { bucket, path };
}
