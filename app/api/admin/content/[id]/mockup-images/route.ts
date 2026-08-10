import { NextResponse } from "next/server";
import sharp from "sharp";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 관리자가 목업 이미지를 직접 올려 교체합니다.
 *
 * 지금까지는 작업마다 이미지 경로를 코드에 박아 넣는 방식이라,
 * 새 이미지를 넣으려면 매번 코드를 고쳐야 했고 재생성 한 번에 전부 사라졌습니다.
 * 여기서 올린 이미지는 저장소에 보관되고 수동 확정 표시가 붙어,
 * '다시 만들기'를 눌러도 확인 없이 덮이지 않습니다.
 */

const BUCKET = "portfolio-rendered";
const MAX_FILES = 12;
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function assetUrl(path: string) {
  return `/api/admin/assets?bucket=${encodeURIComponent(BUCKET)}&path=${encodeURIComponent(path)}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const admin = contentAdmin();

  const { data: item, error: itemError } = await admin
    .from("content_work_items")
    .select("id,format,status,metadata,updated_at")
    .eq("id", id)
    .single();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (item.format !== "portfolio") {
    return NextResponse.json({ error: "포트폴리오 작업에만 이미지를 올릴 수 있습니다." }, { status: 400 });
  }
  if (item.status === "published") {
    return NextResponse.json({ error: "이미 발행한 작업의 이미지는 바꿀 수 없습니다." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "이미지를 읽지 못했습니다." }, { status: 400 });

  const thumbnail = form.get("thumbnail");
  const bodyImages = form.getAll("bodyImages").filter((value): value is File => value instanceof File);
  const files: Array<{ file: File; kind: "thumbnail" | "body_image" }> = [];
  if (thumbnail instanceof File && thumbnail.size > 0) files.push({ file: thumbnail, kind: "thumbnail" });
  for (const file of bodyImages) {
    if (file.size > 0) files.push({ file, kind: "body_image" });
  }

  if (!files.length) {
    return NextResponse.json({ error: "올릴 이미지를 선택해 주세요." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `이미지는 한 번에 ${MAX_FILES}장까지 올릴 수 있습니다.` }, { status: 400 });
  }
  for (const entry of files) {
    if (!ALLOWED_TYPES.has(entry.file.type)) {
      return NextResponse.json({
        error: `${entry.file.name}: PNG, JPG, WEBP 형식만 올릴 수 있습니다.`,
      }, { status: 400 });
    }
    if (entry.file.size > MAX_BYTES) {
      return NextResponse.json({
        error: `${entry.file.name}: 한 장에 12MB를 넘을 수 없습니다.`,
      }, { status: 400 });
    }
  }

  const uploadedAt = new Date().toISOString();
  const folder = `manual/${id}/${uploadedAt.replace(/[:.]/g, "-")}`;
  const uploaded: Array<{
    kind: "thumbnail" | "body_image";
    name: string;
    url: string;
    width: number;
    height: number;
  }> = [];

  for (const [index, entry] of files.entries()) {
    const bytes = Buffer.from(await entry.file.arrayBuffer());
    let width = 0;
    let height = 0;
    try {
      const meta = await sharp(bytes).metadata();
      width = meta.width || 0;
      height = meta.height || 0;
    } catch {
      return NextResponse.json({ error: `${entry.file.name}: 이미지를 읽지 못했습니다.` }, { status: 400 });
    }
    const extension = entry.file.type === "image/png" ? "png"
      : entry.file.type === "image/webp" ? "webp" : "jpg";
    const objectPath = `${folder}/${entry.kind}-${String(index + 1).padStart(2, "0")}.${extension}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: entry.file.type,
      upsert: true,
    });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
    uploaded.push({
      kind: entry.kind,
      name: entry.file.name,
      url: assetUrl(objectPath),
      width,
      height,
    });
  }

  // 검토·외주 화면이 보는 이미지 목록을 새로 올린 것으로 교체합니다.
  const { error: deleteError } = await admin.from("content_review_assets")
    .delete()
    .eq("work_item_id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const { error: insertError } = await admin.from("content_review_assets").insert(
    uploaded.map((asset, index) => ({
      work_item_id: id,
      asset_type: asset.kind,
      public_url: asset.url,
      sort_order: index,
      approved: true,
      review_note: "관리자가 직접 올린 이미지",
    })),
  );
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const metadata = (item.metadata || {}) as Record<string, unknown>;
  const { error: updateError } = await admin.from("content_work_items").update({
    metadata: {
      ...metadata,
      portfolioAssets: uploaded.map((asset) => ({
        kind: asset.kind,
        name: asset.name,
        url: asset.url,
        caption: "관리자가 직접 올린 목업 이미지",
        width: asset.width,
        height: asset.height,
      })),
      // 이 표시가 있으면 '다시 만들기'가 확인 없이 덮어쓰지 않습니다.
      manualMockupOverride: {
        kind: "admin_uploaded",
        approvedAt: uploadedAt,
        approvedBy: user.email || "admin",
        assetNames: uploaded.map((asset) => asset.name),
      },
    },
    updated_at: uploadedAt,
  }).eq("id", id).eq("updated_at", item.updated_at);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    id,
    uploaded: uploaded.length,
    thumbnail: uploaded.filter((asset) => asset.kind === "thumbnail").length,
    bodyImages: uploaded.filter((asset) => asset.kind === "body_image").length,
  });
}
