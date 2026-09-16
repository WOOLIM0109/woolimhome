import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import {
  PARTNER_CHANNELS,
  PARTNER_VISIBLE_STATUSES,
  isPartnerChannel,
  isPartnerVisibleStatus,
  normalizePartnerForceApprovalMemo,
} from "@/lib/partner-portal";
import {
  validateNaverPublication,
  type NormalizedNaverPublication,
} from "@/lib/publication";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticatedPartner();
  if (!user) return apiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.", {
    nextAction: "승인된 Google 계정으로 다시 로그인해 주세요.",
  });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError(400, "INVALID_REQUEST", "발행 정보를 확인해 주세요.");
  }

  const admin = contentAdmin();
  const { data: item, error: readError } = await admin
    .from("content_work_items")
    .select("id, title, channel, status, metadata, published_url_normalized, published_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (
    readError
    || !item
    || !isPartnerChannel(item.channel)
    || !isPartnerVisibleStatus(item.status)
    || !PARTNER_CHANNELS.includes(item.channel)
    || !PARTNER_VISIBLE_STATUSES.includes(item.status)
  ) {
    return apiError(404, "NOT_FOUND", "처리할 수 없는 작업입니다.");
  }

  const requestBody = body as {
    publishedUrl?: unknown;
    force?: unknown;
    forceApprovalMemo?: unknown;
  };
  const forceRequested = requestBody.force === true;
  const forceApprovalMemo = forceRequested
    ? normalizePartnerForceApprovalMemo(requestBody.forceApprovalMemo)
    : null;

  if (forceRequested && !forceApprovalMemo) {
    return apiError(400, "INVALID_REQUEST", "강제승인 메모를 입력해 주세요.", {
      nextAction: "확인할 주소나 내용을 메모 칸에 입력한 뒤 다시 눌러 주세요.",
    });
  }

  let publication: NormalizedNaverPublication | null = null;
  if (!forceRequested) {
    // 일반 등록은 정확한 네이버 글 주소인지 확인합니다. 이 검사가 실패했을 때만
    // 화면에서 별도의 메모 기반 강제승인 절차를 선택할 수 있습니다.
    const validation = validateNaverPublication({
      channel: item.channel,
      publishedUrl: requestBody.publishedUrl,
    });
    if (!validation.ok) {
      const status = validation.code === "PUBLISHED_ACCOUNT_MISMATCH" ? 422 : 400;
      return apiError(status, validation.code, validation.message, {
        nextAction: validation.code === "PUBLISHED_ACCOUNT_MISMATCH"
          ? "현재 채널에 표시된 네이버 블로그에서 발행한 주소를 입력해 주세요."
          : "네이버 게시글 화면의 주소를 다시 복사해 주세요.",
        details: "expectedAccount" in validation
          ? { expectedAccount: validation.expectedAccount, receivedAccount: validation.receivedAccount }
          : undefined,
      });
    }
    publication = validation.publication;
  }

  const metadata = item.metadata
    && typeof item.metadata === "object"
    && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  const partnerHandoff = metadata.partnerHandoff
    && typeof metadata.partnerHandoff === "object"
    && !Array.isArray(metadata.partnerHandoff)
    ? metadata.partnerHandoff as Record<string, unknown>
    : {};

  if (item.status === "published") {
    const sameRegistration = forceRequested
      ? partnerHandoff.forceApproved === true
        && partnerHandoff.forceApprovalMemo === forceApprovalMemo
      : item.published_url_normalized === publication?.normalizedUrl;
    if (sameRegistration) {
      return NextResponse.json({
        id: item.id,
        status: item.status,
        published_at: item.published_at,
        idempotent: true,
        forced: forceRequested,
      }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    }
    return apiError(409, "PUBLISHED_URL_CONFLICT", "이미 발행 완료된 작업의 기록은 외주 화면에서 변경할 수 없습니다.", {
      nextAction: "기록 수정이 필요하면 관리자에게 요청해 주세요.",
    });
  }

  if (publication) {
    const { data: conflict } = await admin
      .from("content_work_items")
      .select("id,title,channel,status")
      .eq("published_url_normalized", publication.normalizedUrl)
      .neq("id", id)
      .maybeSingle();
    if (conflict) {
      // 일반 등록은 중복을 알려 주고 멈춥니다. 사용자가 강제승인을 선택하면
      // 주소를 검증 필드가 아닌 메모로 남겨 두 작업을 모두 보존합니다.
      const alreadyPublished = conflict.status === "published";
      return apiError(409, "PUBLISHED_URL_CONFLICT", alreadyPublished
        ? `이 주소는 이미 발행 완료로 등록된 다른 작업(${conflict.title})에 연결되어 있습니다.`
        : "이미 다른 작업에 등록된 발행 주소입니다.", {
        nextAction: alreadyPublished
          ? "같은 글이 두 작업에 해당한다면 아래 강제승인 메모에 주소를 남겨 처리해 주세요."
          : "기존 게시글 주소가 아닌 현재 작업의 새 게시글 주소를 입력해 주세요.",
        details: {
          conflictItemId: conflict.id,
          conflictTitle: conflict.title,
          conflictChannel: conflict.channel,
          conflictStatus: conflict.status,
          duplicateWorkItem: alreadyPublished,
        },
      });
    }
  }

  const completedAt = new Date().toISOString();
  const handoffMetadata = forceRequested
    ? {
        forceApproved: true,
        forceApprovalMemo,
        completedAt,
        completedBy: user.email,
      }
    : {
        publishedUrl: publication!.normalizedUrl,
        publishedAccount: publication!.account,
        completedAt,
        completedBy: user.email,
      };
  const { data, error } = await admin
    .from("content_work_items")
    .update({
      status: "published",
      published_at: completedAt,
      published_url: publication?.normalizedUrl || null,
      published_url_normalized: publication?.normalizedUrl || null,
      published_account: publication?.account || null,
      metadata: {
        ...metadata,
        partnerHandoff: handoffMetadata,
      },
      updated_at: completedAt,
    })
    .eq("id", id)
    .eq("updated_at", item.updated_at)
    .in("channel", PARTNER_CHANNELS)
    .in("status", PARTNER_VISIBLE_STATUSES)
    .select("id, status, published_at")
    .single();

  if (error?.code === "23505") {
    return apiError(409, "PUBLISHED_URL_CONFLICT", "이미 다른 작업에 등록된 발행 주소입니다.", {
      nextAction: "현재 작업에서 새로 발행한 게시글 주소를 입력해 주세요.",
    });
  }
  if (error?.code === "PGRST116") {
    return apiError(409, "CONTENT_CHANGED", "발행 등록 직전에 원고 또는 목업 상태가 변경되었습니다.", {
      retryable: true,
      nextAction: "화면을 새로고침해 최신 검토 상태를 확인한 뒤 다시 등록해 주세요.",
    });
  }
  if (error) return apiError(500, "INTERNAL_ERROR", "발행 완료 상태를 저장하지 못했습니다.", {
    retryable: true,
    nextAction: "잠시 후 다시 시도해 주세요.",
  });
  await admin.from("content_publication_events").insert({
    work_item_id: item.id,
    channel: item.channel,
    event_type: "published",
    published_url_normalized: publication?.normalizedUrl || null,
    published_account: publication?.account || null,
    actor_email: user.email,
    metadata: { source: "partner_portal", forced: forceRequested },
  });
  return NextResponse.json({ ...data, forced: forceRequested }, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

