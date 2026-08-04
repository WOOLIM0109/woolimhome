import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import {
  PARTNER_CHANNELS,
  PARTNER_VISIBLE_STATUSES,
  isPartnerChannel,
  isPartnerVisibleStatus,
} from "@/lib/partner-portal";
import { validateNaverPublication } from "@/lib/publication";

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
    .select("id, title, channel, status, metadata, published_url_normalized, published_at")
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

  const validation = validateNaverPublication({
    channel: item.channel,
    publishedUrl: (body as { publishedUrl?: unknown }).publishedUrl,
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

  if (item.status === "published") {
    if (item.published_url_normalized === validation.publication.normalizedUrl) {
      return NextResponse.json({
        id: item.id,
        status: item.status,
        published_at: item.published_at,
        idempotent: true,
      }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
    }
    return apiError(409, "PUBLISHED_URL_CONFLICT", "이미 발행 완료된 작업의 주소는 외주 화면에서 변경할 수 없습니다.", {
      nextAction: "주소 수정이 필요하면 관리자에게 요청해 주세요.",
    });
  }

  const { data: conflict } = await admin
    .from("content_work_items")
    .select("id,title,channel")
    .eq("published_url_normalized", validation.publication.normalizedUrl)
    .neq("id", id)
    .maybeSingle();
  if (conflict) {
    return apiError(409, "PUBLISHED_URL_CONFLICT", "이미 다른 작업에 등록된 발행 주소입니다.", {
      nextAction: "기존 게시글 주소가 아닌 현재 작업의 새 게시글 주소를 입력해 주세요.",
      details: { conflictItemId: conflict.id, conflictTitle: conflict.title, conflictChannel: conflict.channel },
    });
  }

  const completedAt = new Date().toISOString();
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const { data, error } = await admin
    .from("content_work_items")
    .update({
      status: "published",
      published_at: completedAt,
      published_url: validation.publication.normalizedUrl,
      published_url_normalized: validation.publication.normalizedUrl,
      published_account: validation.publication.account,
      metadata: {
        ...metadata,
        partnerHandoff: {
          publishedUrl: validation.publication.normalizedUrl,
          publishedAccount: validation.publication.account,
          completedAt,
          completedBy: user.email,
        },
      },
      updated_at: completedAt,
    })
    .eq("id", id)
    .in("channel", PARTNER_CHANNELS)
    .in("status", PARTNER_VISIBLE_STATUSES)
    .select("id, status, published_at")
    .single();

  if (error?.code === "23505") {
    return apiError(409, "PUBLISHED_URL_CONFLICT", "이미 다른 작업에 등록된 발행 주소입니다.", {
      nextAction: "현재 작업에서 새로 발행한 게시글 주소를 입력해 주세요.",
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
    published_url_normalized: validation.publication.normalizedUrl,
    published_account: validation.publication.account,
    actor_email: user.email,
    metadata: { source: "partner_portal" },
  });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

