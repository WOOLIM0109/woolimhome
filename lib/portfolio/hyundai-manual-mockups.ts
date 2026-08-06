export const HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE =
  "대기업 의사결정권자의 시선을 사로잡는 비즈니스 제안서: 22개 장표의 일관된 그리드와 정보 밀도 제어 기술";
export const HYUNDAI_MANUAL_MOCKUP_TITLE =
  "생활폐기물 수집·운반 대행용역 입찰제안서 디자인: 16개 장표에 담은 현장 수행계획";

export function isHyundaiManualMockupTitle(title: unknown) {
  return title === HYUNDAI_MANUAL_MOCKUP_TITLE || title === HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE;
}

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

const HYUNDAI_CORRECTED_SUMMARY =
  "생활폐기물 수집·운반 대행용역의 사업개요, 책임 수거체계, 민원 대응, 적환장 운영, 안전보건과 노사관리 계획을 16개 장표로 구조화한 입찰제안서 디자인 사례입니다.";

const HYUNDAI_BODY_CAPTIONS = [
  "생활폐기물 수집·운반 대행용역의 사업개요와 책임 수거체계를 정리한 입찰제안서 목업",
  "민원 처리와 적환장 운영, 안전보건 계획을 도식화한 입찰제안서 목업",
  "노사관리와 성공적인 사업 수행방안을 일관된 그리드로 구성한 입찰제안서 목업",
] as const;

function correctedFigure(origin: string, index: number) {
  const asset = HYUNDAI_MANUAL_MOCKUP_ASSETS.filter((item) => item.kind === "body_image")[index];
  const caption = HYUNDAI_BODY_CAPTIONS[index];
  return `<figure><img src="${assetUrl(origin, asset.name)}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`;
}

function correctedHyundaiBodyHtml(origin: string) {
  return [
    "<h2>평가 항목이 한눈에 보이는 입찰제안서 구조</h2>",
    "<p>이번 작업은 생활폐기물 수집·운반 대행용역 입찰을 위한 제안서 디자인입니다. 일반 기업의 상품이나 서비스를 소개하는 문서가 아닙니다. 발주기관이 요구한 과업을 안정적으로 수행할 수 있다는 점을 증명하는 공공용역 제안서입니다.</p>",
    "<p>표지와 목차 뒤에는 사업목표와 보유 역량을 먼저 배치했습니다. 이후 수집·운반 계획, 민원 대응, 작업장 관리, 안전보건, 노사관계와 비상대책으로 이어지도록 구성했습니다. 평가자가 필요한 항목을 빠르게 찾을 수 있도록 제안요청서의 흐름과 발표 순서를 맞춘 것입니다.</p>",
    "<p>각 장표의 제목은 해당 페이지에서 검토할 내용을 바로 보여줍니다. 긴 설명보다 책임 수거, 신속 처리, 안전관리처럼 판단에 필요한 핵심어를 앞에 배치했습니다. 덕분에 발표를 듣지 않고 문서만 보더라도 전체 수행체계를 따라갈 수 있습니다.</p>",
    correctedFigure(origin, 0),
    "<h2>수거 누락을 줄이는 책임 수거체계 시각화</h2>",
    "<p>생활폐기물 대행용역에서는 멋진 소개 문구보다 실제 수거 방식이 중요합니다. 일반주택과 공동주택의 배출 특성을 구분하고, 생활폐기물이 수거 차량에서 적환장을 거쳐 최종처리장으로 이동하는 과정을 도식으로 정리했습니다.</p>",
    "<p>구역별 책임자와 차량 담당을 연결해 수거 지연이나 누락을 줄이는 구조도 함께 보여줬습니다. 좁은 골목과 다량 배출 거점처럼 현장에서 생기는 변수는 별도의 실행 항목으로 분리했습니다. 인력과 장비를 어떻게 투입할지 한 장 안에서 확인할 수 있도록 만든 구성입니다.</p>",
    "<p>차량 종류와 작업 순서는 단순한 목록으로 나열하지 않았습니다. 수거 대상, 운반 장비, 중간 작업, 최종 처리의 관계가 이어지도록 시선을 설계했습니다. 복잡한 현장 업무를 평가자가 짧은 시간 안에 이해하도록 돕기 위한 선택입니다.</p>",
    "<h2>민원 접수부터 결과 안내까지 끊기지 않는 흐름</h2>",
    "<p>공공 청소서비스는 수거 실적만큼 주민 민원 대응이 중요합니다. 민원 접수, 담당자 지정, 현장 확인, 즉시 처리, 결과 통보와 만족도 확인까지 이어지는 절차를 하나의 흐름으로 표현했습니다.</p>",
    "<p>미수거와 혼합배출처럼 원인이 다른 민원은 처리 방식도 달라야 합니다. 업체 책임이 있는 경우와 올바르지 않은 배출이 원인인 경우를 구분해 대응 원칙을 제시했습니다. 주민 입장에서는 처리 속도를, 발주기관 입장에서는 보고 체계를 확인할 수 있습니다.</p>",
    "<p>대민서비스 장표에는 친절 교육, 작업복, 차량 청결, 소음과 악취 예방 항목을 함께 배치했습니다. 생활폐기물 수거가 단순 운반이 아니라 주민 생활과 맞닿은 공공서비스라는 점을 디자인에서도 드러냈습니다.</p>",
    correctedFigure(origin, 1),
    "<h2>적환장 운영과 현장 관리 역량을 구체적으로 제시</h2>",
    "<p>차고지와 적환장은 대행용역의 실행 가능성을 판단하는 핵심 시설입니다. 작업장 위치와 면적, 대행구역과의 거리, 공간 활용방식을 지도와 수치 중심으로 정리했습니다. 보유 시설이 실제 업무 효율로 어떻게 이어지는지 설명하는 데 초점을 맞췄습니다.</p>",
    "<p>작업 전후의 정리, 차량과 수거용기 관리, 당일 처리 원칙도 별도 장표로 구성했습니다. 혐오시설이라는 인식을 줄이기 위해 청결 관리와 주변 민원 예방을 함께 보여줬습니다. 시설 사진과 운영 절차가 서로 보완되도록 배치한 이유입니다.</p>",
    "<h2>안전보건과 노사관계를 사업 연속성으로 연결</h2>",
    "<p>수집·운반 업무는 차량 운행과 야외 작업이 많아 안전관리 체계가 반드시 필요합니다. 연간 안전보건 일정, 위험성 평가, 보호장비, 차량 점검과 비상조치 계획을 시간 흐름과 실행 주체에 따라 구분했습니다.</p>",
    "<p>근로자 복지와 노사관계도 별개의 부가 항목으로 다루지 않았습니다. 샤워실과 탈의실 같은 시설, 고충 처리, 협의체 운영, 교육과 건강관리 계획을 안정적인 인력 운영의 근거로 연결했습니다.</p>",
    "<p>파업이나 결원이 발생했을 때의 대체 인력과 업무 정상화 방안도 명확하게 제시했습니다. 발주기관이 가장 우려하는 서비스 중단 가능성에 답하도록 구성한 것입니다. 평상시 관리와 비상 대응이 하나의 체계로 읽히도록 만들었습니다.</p>",
    correctedFigure(origin, 2),
    "<h2>16개 장표를 일관되게 읽히게 만든 디자인 원칙</h2>",
    "<p>전체 문서는 같은 제목 위치와 본문 그리드를 유지했습니다. 다만 내용에 따라 표, 순서도, 지도, 일정표와 사진의 비중을 달리해 반복감을 줄였습니다. 평가 항목은 바뀌어도 읽는 위치는 흔들리지 않도록 한 것입니다.</p>",
    "<p>강조색은 핵심 절차와 구분 제목에만 제한적으로 사용했습니다. 정보가 많은 페이지에서는 배경 면과 간격으로 항목을 나눴습니다. 작은 글씨를 무조건 줄이는 대신 정보 묶음과 우선순위를 먼저 정리했습니다.</p>",
    "<p>이 제안서의 목적은 생활폐기물 수집·운반 업무를 안정적으로 수행할 준비가 되어 있음을 발주기관에 증명하는 것입니다. 현장 수행계획과 주민 서비스가 정확히 보이도록 기획과 디자인을 맞춘 사례입니다.</p>",
  ].join("");
}

export function correctHyundaiManualContentMetadata(
  metadata: Record<string, unknown> | null,
  origin: string,
) {
  const value = metadata || {};
  const generated = generatedRecord(value) || {};
  const bodyAssets = HYUNDAI_MANUAL_MOCKUP_ASSETS.filter((asset) => asset.kind === "body_image");
  const seededMetadata = {
    ...value,
    generated: {
      ...generated,
      title: HYUNDAI_MANUAL_MOCKUP_TITLE,
      summary: HYUNDAI_CORRECTED_SUMMARY,
      bodyHtml: correctedHyundaiBodyHtml(origin),
      faq: [
        {
          question: "생활폐기물 수집·운반 입찰제안서에서 먼저 보여줘야 할 내용은 무엇인가요?",
          answer: "발주기관 평가항목과 연결된 수행체계입니다. 수거 노선, 인력·장비, 민원 처리와 안전관리 흐름을 먼저 제시해야 합니다.",
        },
        {
          question: "수집·운반 작업계획은 어떻게 정리해야 이해하기 쉬운가요?",
          answer: "수거 대상에서 차량, 적환장과 최종처리장으로 이어지는 순서를 도식으로 보여주세요. 구역별 책임자와 예외 상황의 대응 방식도 함께 표시하면 좋습니다.",
        },
        {
          question: "민원 대응 장표에는 어떤 내용이 필요할까요?",
          answer: "접수, 담당자 지정, 현장 처리, 결과 통보와 만족도 확인 절차가 필요합니다. 미수거와 잘못된 배출처럼 원인에 따른 처리 기준도 구분해야 합니다.",
        },
        {
          question: "여러 장의 입찰제안서를 일관되게 보이게 하려면 어떻게 해야 하나요?",
          answer: "제목과 본문, 하단 정보의 위치를 고정하세요. 표와 도식의 형태는 내용에 맞게 바꾸되 색상과 글자 위계는 같은 규칙을 유지하는 것이 좋습니다.",
        },
      ],
      tags: [
        "생활폐기물", "수집운반", "대행용역", "입찰제안서", "공공입찰",
        "청소용역", "제안서디자인", "PPT디자인", "공공서비스",
      ],
      imageCaptions: [...HYUNDAI_BODY_CAPTIONS],
    },
    portfolioAssets: [
      ...(Array.isArray(value.portfolioAssets)
        ? value.portfolioAssets.filter((asset) => (
          !asset || typeof asset !== "object" || (asset as Record<string, unknown>).kind !== "body_image"
        ))
        : []),
      ...bodyAssets.map((asset, index) => ({
        ...asset,
        slideIndexes: [...asset.slideIndexes],
        url: assetUrl(origin, asset.name),
        caption: HYUNDAI_BODY_CAPTIONS[index],
        slideAspectRatio: 780 / 540,
        mockupMode: "six_grid" as const,
        aspectClass: "a4_landscape" as const,
      })),
    ],
    contentCorrection: {
      kind: "source_deck_verified",
      correctedAt: new Date().toISOString(),
      sourceSlideCount: 16,
      documentType: "생활폐기물 수집·운반 대행용역 입찰제안서",
    },
  };
  return buildHyundaiManualMockupMetadata(seededMetadata, origin);
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
  if (!isHyundaiManualMockupTitle(item.title) || item.format !== "portfolio") return item;
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
  if (!isHyundaiManualMockupTitle(title)) return null;
  return buildHyundaiManualMockupMetadata(metadata, origin, { approvedBy });
}
