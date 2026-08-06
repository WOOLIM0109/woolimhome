export const HYUNDAI_MANUAL_MOCKUP_TITLE =
  "대기업 의사결정권자의 시선을 사로잡는 비즈니스 제안서: 22개 장표의 일관된 그리드와 정보 밀도 제어 기술";

const HYUNDAI_MANUAL_MOCKUP_PATH = "/portfolio/manual/hyundai-sanitation";
const HYUNDAI_MANUAL_APPLIED_AT = "2026-08-06T18:00:00+09:00";

export const HYUNDAI_MANUAL_MOCKUP_ASSETS = [
  {
    kind: "thumbnail" as const,
    name: "thumbnail.jpg",
    slideIndexes: [0],
    width: 1080,
    height: 1080,
  },
  {
    kind: "body_image" as const,
    name: "multi-page-1.jpg",
    slideIndexes: [0, 1, 2, 3, 4, 5],
    width: 1600,
    height: 1000,
  },
  {
    kind: "body_image" as const,
    name: "multi-page-2.jpg",
    slideIndexes: [6, 7, 8, 9, 10],
    width: 1600,
    height: 1000,
  },
  {
    kind: "body_image" as const,
    name: "multi-page-3.jpg",
    slideIndexes: [11, 12, 13, 14, 15],
    width: 1600,
    height: 1000,
  },
] as const;

function assetUrl(origin: string, name: string) {
  return `${origin}${HYUNDAI_MANUAL_MOCKUP_PATH}/${name}`;
}

function replaceBodyImageSources(bodyHtml: string, urls: string[]) {
  const matches = [...bodyHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/gi)];
  if (matches.length !== urls.length) return null;
  let imageIndex = 0;
  return bodyHtml.replace(
    /(<img\b[^>]*\bsrc\s*=\s*["'])[^"']+(["'][^>]*>)/gi,
    (_match, prefix: string, suffix: string) => `${prefix}${urls[imageIndex++]}${suffix}`,
  );
}

function generatedRecord(metadata: Record<string, unknown>) {
  return metadata.generated && typeof metadata.generated === "object" && !Array.isArray(metadata.generated)
    ? metadata.generated as Record<string, unknown>
    : null;
}

function previousBodyCaptions(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.portfolioAssets)
    ? metadata.portfolioAssets
      .filter((asset) => asset && typeof asset === "object"
        && (asset as Record<string, unknown>).kind === "body_image")
      .map((asset) => {
        const caption = (asset as Record<string, unknown>).caption;
        return typeof caption === "string" ? caption : "";
      })
    : [];
}

export function buildHyundaiManualMockupMetadata(
  metadata: Record<string, unknown> | null,
  origin: string,
  approval?: { approvedBy: string; approvedAt?: string },
) {
  const value = metadata || {};
  const generated = generatedRecord(value);
  const bodyHtml = typeof generated?.bodyHtml === "string" ? generated.bodyHtml : "";
  const bodyAssets = HYUNDAI_MANUAL_MOCKUP_ASSETS.filter((asset) => asset.kind === "body_image");
  const bodyUrls = bodyAssets.map((asset) => assetUrl(origin, asset.name));
  const replacedBodyHtml = replaceBodyImageSources(bodyHtml, bodyUrls);
  if (!generated || !replacedBodyHtml) return null;

  const captions = previousBodyCaptions(value);
  const retainedAssets = Array.isArray(value.portfolioAssets)
    ? value.portfolioAssets.filter((asset) => {
      if (!asset || typeof asset !== "object") return true;
      const kind = (asset as Record<string, unknown>).kind;
      return kind !== "thumbnail" && kind !== "body_image";
    })
    : [];
  let bodyIndex = 0;
  const manualAssets = HYUNDAI_MANUAL_MOCKUP_ASSETS.map((asset) => {
    const caption = asset.kind === "body_image"
      ? captions[bodyIndex++] || "생활폐기물 수집·운반 대행용역 입찰제안서 디자인 목업"
      : "생활폐기물 수집·운반 대행용역 입찰제안서 대표 썸네일";
    return {
      ...asset,
      slideIndexes: [...asset.slideIndexes],
      url: assetUrl(origin, asset.name),
      caption,
      slideAspectRatio: 780 / 540,
      mockupMode: "six_grid" as const,
      aspectClass: "a4_landscape" as const,
    };
  });
  const selectedSlideIndexes = [...new Set(
    bodyAssets.flatMap((asset) => [...asset.slideIndexes]),
  )];
  const existingMockup = value.portfolioMockup && typeof value.portfolioMockup === "object"
    ? value.portfolioMockup as Record<string, unknown>
    : {};
  const existingOverride = value.manualMockupOverride && typeof value.manualMockupOverride === "object"
    ? value.manualMockupOverride as Record<string, unknown>
    : {};
  const approvedAt = approval?.approvedAt || new Date().toISOString();

  return {
    ...value,
    generated: {
      ...generated,
      bodyHtml: replacedBodyHtml,
    },
    portfolioAssets: [...retainedAssets, ...manualAssets],
    portfolioMockup: {
      ...existingMockup,
      mode: "six_grid",
      bodyBoardCount: 3,
      aspectClass: "a4_landscape",
      selectedSlideIndexes,
      selectionReasons: selectedSlideIndexes.map(
        (index) => `장표 ${index + 1} · 관리자 수동 선택 및 기밀 가림 검수 완료`,
      ),
      redactionRegionCount: undefined,
      redactionCoverage: undefined,
      redactionStatus: "verified",
      manualSelectiveRedaction: true,
    },
    manualMockupOverride: {
      ...existingOverride,
      kind: "powerpoint_native_user_redacted",
      appliedAt: typeof existingOverride.appliedAt === "string"
        ? existingOverride.appliedAt
        : HYUNDAI_MANUAL_APPLIED_AT,
      assetNames: HYUNDAI_MANUAL_MOCKUP_ASSETS.map((asset) => asset.name),
      ...(approval ? { approvedAt, approvedBy: approval.approvedBy } : {}),
    },
  };
}

export function applyHyundaiManualMockups(item: Record<string, unknown>, origin: string) {
  if (item.title !== HYUNDAI_MANUAL_MOCKUP_TITLE || item.format !== "portfolio") return item;
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  const manualMetadata = buildHyundaiManualMockupMetadata(metadata, origin);
  if (!manualMetadata) return item;

  const retainedReviewAssets = Array.isArray(item.content_review_assets)
    ? item.content_review_assets.filter((asset) => {
      if (!asset || typeof asset !== "object") return true;
      const type = (asset as Record<string, unknown>).asset_type;
      return type !== "thumbnail" && type !== "body_image";
    })
    : [];
  const manualAssets = manualMetadata.portfolioAssets as Array<Record<string, unknown>>;
  const renderedAssets = manualAssets.filter((asset) => (
    asset.kind === "thumbnail" || asset.kind === "body_image"
  ));
  return {
    ...item,
    metadata: manualMetadata,
    content_review_assets: [
      ...retainedReviewAssets,
      ...renderedAssets.map((asset, index) => ({
        id: `manual-hyundai-${index + 1}`,
        work_item_id: item.id,
        asset_type: asset.kind,
        public_url: asset.url,
        sort_order: index,
        approved: false,
        review_note: `${asset.caption} · 관리자 수동 기밀 가림 완료`,
      })),
    ],
  };
}

export function hyundaiManualApprovalMetadata(
  title: unknown,
  metadata: Record<string, unknown> | null,
  origin: string,
  approvedBy: string,
) {
  if (title !== HYUNDAI_MANUAL_MOCKUP_TITLE) return null;
  return buildHyundaiManualMockupMetadata(metadata, origin, { approvedBy });
}
