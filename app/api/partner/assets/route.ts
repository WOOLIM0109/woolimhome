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
  if (!stored) return NextResponse.json({ error: "지원하지 않는 이미지입니다." }, { status: 400 });

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
  const fileName = `${asset.asset_type}-${asset.id.slice(0, 8)}.${extension}`;
  const download = url.searchParams.get("download") === "1";

  return new NextResponse(image, {
    headers: {
      "Content-Type": image.type || (extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png"),
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      Vary: "Cookie",
    },
  });
}

