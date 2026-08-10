import { NextResponse } from "next/server";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import {
  PARTNER_CHANNELS,
  PARTNER_VISIBLE_STATUSES,
  isPartnerChannel,
  isPartnerVisibleStatus,
  parseStoredAssetUrl,
} from "@/lib/partner-portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetRow = {
  id: string;
  asset_type: string;
  public_url: string;
  content_work_items:
    | { channel: string; status: string }
    | { channel: string; status: string }[]
    | null;
};

const FALLBACK_SITE_URL = "https://woolim-site.vercel.app";

/** 외주 작업실에서 열 수 있는 이미지 경로. 자동 생성분과 수동 확정분을 모두 포함합니다. */
const ALLOWED_ASSET_PREFIXES = ["/portfolio-drafts/", "/portfolio/manual/"];

function parsePortfolioAssetUrl(publicUrl: string, requestUrl: string) {
  const requestOrigin = new URL(requestUrl).origin;
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || FALLBACK_SITE_URL;
  const configuredOrigin = new URL(configuredSiteUrl).origin;
  const parsed = new URL(publicUrl, configuredSiteUrl);
  const decodedPath = decodeURIComponent(parsed.pathname);
  const allowedOrigins = new Set([requestOrigin, configuredOrigin, new URL(FALLBACK_SITE_URL).origin]);

  if (
    !allowedOrigins.has(parsed.origin)
    // 관리자가 직접 넣은 목업 이미지는 /portfolio/manual/ 아래에 있습니다.
    // 이 경로를 빼면 수동 이미지가 외주 작업실에서 전부 깨져 보입니다.
    || !ALLOWED_ASSET_PREFIXES.some((prefix) => decodedPath.startsWith(prefix))
    || decodedPath.includes("..")
    || !/\.(?:png|jpe?g|webp)$/i.test(decodedPath)
  ) {
    return null;
  }

  return parsed;
}

function assetFileName(asset: AssetRow, sourcePath: string) {
  const originalName = decodeURIComponent(sourcePath.split("/").pop() || "");
  if (/^[\p{L}\p{N}._-]+\.(?:png|jpe?g|webp)$/iu.test(originalName)) {
    return originalName;
  }

  const extension = sourcePath.split(".").pop()?.toLowerCase() || "png";
  return `${asset.asset_type}-${asset.id.slice(0, 8)}.${extension}`;
}

function assetHeaders(contentType: string, fileName: string, download: boolean) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    Vary: "Cookie",
  };
}

export async function GET(request: Request) {
  const user = await authenticatedPartner();
  if (!user) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "이미지 정보가 없습니다." }, { status: 400 });

  const admin = contentAdmin();
  const { data, error } = await admin
    .from("content_review_assets")
    .select("id, asset_type, public_url, content_work_items!inner(channel, status)")
    .eq("id", id)
    .maybeSingle();

  const asset = data as AssetRow | null;
  const parentValue = asset?.content_work_items;
  const parent = Array.isArray(parentValue) ? parentValue[0] : parentValue;
  if (
    error
    || !asset
    || !parent
    || !isPartnerChannel(parent.channel)
    || !isPartnerVisibleStatus(parent.status)
    || !PARTNER_CHANNELS.includes(parent.channel)
    || !PARTNER_VISIBLE_STATUSES.includes(parent.status)
  ) {
    return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
  }

  const stored = parseStoredAssetUrl(asset.public_url);
  const download = url.searchParams.get("download") === "1";

  if (!stored) {
    const portfolioAsset = parsePortfolioAssetUrl(asset.public_url, request.url);
    if (!portfolioAsset) {
      return NextResponse.json({ error: "지원하지 않는 이미지입니다." }, { status: 400 });
    }

    try {
      const response = await fetch(portfolioAsset, {
        cache: "force-cache",
        redirect: "error",
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) {
        return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
      }

      const fileName = assetFileName(asset, portfolioAsset.pathname);
      return new NextResponse(response.body, {
        headers: assetHeaders(contentType, fileName, download),
      });
    } catch {
      return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
    }
  }

  const { data: image, error: downloadError } = await admin.storage
    .from(stored.bucket)
    .download(stored.path);
  if (downloadError || !image) {
    return NextResponse.json(
      { error: downloadError?.message || "이미지를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const extension = stored.path.split(".").pop()?.toLowerCase() || "png";
  const fileName = assetFileName(asset, stored.path);

  return new NextResponse(image, {
    headers: assetHeaders(
      image.type || (extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png"),
      fileName,
      download,
    ),
  });
}
