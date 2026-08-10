import { NextResponse } from "next/server";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import {
  PARTNER_CHANNELS,
  PARTNER_VISIBLE_STATUSES,
  isPartnerChannel,
  isVisibleToPartner,
  partnerAssetUrl,
  replaceAdminAssetUrls,
  replaceFiguresWithMarkers,
} from "@/lib/partner-portal";
import { expectedNaverAccount } from "@/lib/publication";
import { sanitizeGeneratedHtml } from "@/lib/security/html";
import { PRIVATE_PORTFOLIO_SOURCE_NOTE } from "@/lib/content-ops/source-section";

export const dynamic = "force-dynamic";

type GeneratedContent = {
  bodyHtml?: string;
  faq?: { question: string; answer: string }[];
  tags?: string[];
  sourceUrls?: string[];
};

type ReviewAsset = {
  id: string;
  asset_type: "thumbnail" | "body_image" | "article_preview";
  public_url: string;
  sort_order: number | null;
};

type WorkItemRow = {
  id: string;
  channel: "naver_consulting" | "naver_design";
  format: string;
  title: string;
  summary: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  published_url: string | null;
  metadata: {
    generated?: GeneratedContent;
    novelty?: {
      duplicate?: boolean;
    };
    partnerReleaseOverride?: {
      approvedAt?: string;
    };
    validation?: {
      issues?: string[];
    };
    partnerHandoff?: {
      publishedUrl?: string;
      completedAt?: string;
    };
    publicationValidation?: {
      duplicateLegacyUrl?: boolean;
    };
  } | null;
  content_review_assets: ReviewAsset[] | null;
};

export async function GET(request: Request) {
  const user = await authenticatedPartner();
  if (!user) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 401 });

  const url = new URL(request.url);
  const requestedChannel = url.searchParams.get("channel");
  if (requestedChannel && !isPartnerChannel(requestedChannel)) {
    return NextResponse.json({ error: "허용되지 않은 채널입니다." }, { status: 400 });
  }

  let query = contentAdmin()
    .from("content_work_items")
    .select(
      "id, channel, format, title, summary, status, scheduled_at, published_at, published_url, metadata, content_review_assets(id, asset_type, public_url, sort_order)",
    )
    .in("channel", PARTNER_CHANNELS)
    .in("status", PARTNER_VISIBLE_STATUSES)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  if (requestedChannel) query = query.eq("channel", requestedChannel);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 노출 판단은 lib/partner-portal 한 곳에서만 합니다.
  // 관리자 화면이 같은 함수로 사유를 보여 주므로, 여기서 조용히 빠지는 작업이 없습니다.
  const items = ((data || []) as WorkItemRow[])
    .filter((item) => isVisibleToPartner(item))
    .map((item) => {
      const hasLegacyDuplicateUrl = item.metadata?.publicationValidation?.duplicateLegacyUrl === true;
      const storedAssets = [...(item.content_review_assets || [])]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      const uploadableAssets = storedAssets.filter((asset) => asset.asset_type !== "article_preview");
      const generated = item.metadata?.generated || {};
      const originalBodyHtml = sanitizeGeneratedHtml(generated.bodyHtml || "");
      let thumbnailNumber = 0;
      let bodyImageNumber = 0;

      return {
        id: item.id,
        channel: item.channel,
        format: item.format,
        title: item.title,
        summary: item.summary,
        status: item.status,
        scheduledAt: item.scheduled_at,
        publishedAt: item.published_at,
        publishedUrl: hasLegacyDuplicateUrl
          ? null
          : item.published_url || item.metadata?.partnerHandoff?.publishedUrl || null,
        publicationWarning: hasLegacyDuplicateUrl
          ? "기존 발행 URL이 다른 작업과 중복되어 관리자 확인이 필요합니다."
          : null,
        completedAt: item.metadata?.partnerHandoff?.completedAt || null,
        previewHtml: replaceAdminAssetUrls(originalBodyHtml, storedAssets),
        copyHtml: replaceFiguresWithMarkers(originalBodyHtml),
        faq: Array.isArray(generated.faq) ? generated.faq : [],
        tags: Array.isArray(generated.tags) ? generated.tags : [],
        sourceUrls: Array.isArray(generated.sourceUrls) ? generated.sourceUrls : [],
        sourceNote: item.format === "portfolio" ? PRIVATE_PORTFOLIO_SOURCE_NOTE : null,
        assets: uploadableAssets.map((asset) => {
          const order = asset.asset_type === "thumbnail"
            ? ++thumbnailNumber
            : ++bodyImageNumber;
          return {
            id: asset.id,
            type: asset.asset_type,
            order,
            previewUrl: partnerAssetUrl(asset.id),
            downloadUrl: partnerAssetUrl(asset.id, true),
          };
        }),
      };
    });

  const channels = PARTNER_CHANNELS.map((channel) => {
    const account = expectedNaverAccount(channel);
    return {
      value: channel,
      account,
      blogUrl: account ? `https://blog.naver.com/${account}` : null,
    };
  });

  return NextResponse.json({ items, channels }, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
