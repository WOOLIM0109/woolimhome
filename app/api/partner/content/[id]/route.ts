import { NextResponse } from "next/server";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import {
  PARTNER_CHANNELS,
  PARTNER_VISIBLE_STATUSES,
  isPartnerChannel,
  isPartnerVisibleStatus,
} from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

function isNaverBlogUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && parsed.hostname === "blog.naver.com";
  } catch {
    return false;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticatedPartner();
  if (!user) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  if (!isNaverBlogUrl(body.publishedUrl)) {
    return NextResponse.json(
      { error: "https://blog.naver.com/으로 시작하는 발행 글 주소를 입력해 주세요." },
      { status: 400 },
    );
  }

  const admin = contentAdmin();
  const { data: item, error: readError } = await admin
    .from("content_work_items")
    .select("id, channel, status, metadata")
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
    return NextResponse.json({ error: "처리할 수 없는 작업입니다." }, { status: 404 });
  }

  const completedAt = new Date().toISOString();
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const { data, error } = await admin
    .from("content_work_items")
    .update({
      status: "published",
      published_at: completedAt,
      metadata: {
        ...metadata,
        partnerHandoff: {
          publishedUrl: body.publishedUrl.trim(),
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

