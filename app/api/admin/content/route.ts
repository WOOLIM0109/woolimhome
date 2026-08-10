import { NextResponse } from "next/server";
import {
  coverTitleSignature,
  parseCoverTitleHistory,
  suggestCoverTitles,
  type CoverTitleRecord,
} from "@/lib/portfolio/cover-title";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { isPartnerChannel, partnerVisibilityBlockers } from "@/lib/partner-portal";
import { sanitizeWorkItemMetadata } from "@/lib/security/html";
import type { WorkflowStatus } from "@/lib/content-ops/types";
import { applyHyundaiManualMockups } from "@/lib/portfolio/hyundai-manual-mockups";

export const dynamic = "force-dynamic";

const CREATABLE_STATUSES = new Set<WorkflowStatus>([
  "topic_candidate", "researching", "creating", "review_required", "approved",
  "naver_ready", "scheduled", "on_hold",
]);

const PORTFOLIO_JOB_TYPES = new Set(["mockup", "draft"]);
const PORTFOLIO_JOB_STATUSES = new Set([
  "queued", "running", "completed", "failed", "on_hold",
]);

const TOURISM_MARKETING_WORK_ITEM_ID = "6579c77c-86fd-4b6a-9e65-654394597c8f";
const TOURISM_MARKETING_MANUAL_ASSETS = [
  { name: "short-main.jpg", slideIndexes: [2, 4, 5, 9, 10], width: 1600, height: 1600 },
  { name: "short-detail-1.jpg", slideIndexes: [0, 1, 3], width: 1600, height: 900 },
  { name: "short-detail-2.jpg", slideIndexes: [6, 7, 8], width: 1600, height: 900 },
  { name: "short-detail-3.jpg", slideIndexes: [11, 12, 13], width: 1600, height: 900 },
] as const;

function applyManualTourismMockups(item: Record<string, unknown>, origin: string) {
  if (item.id !== TOURISM_MARKETING_WORK_ITEM_ID) return item;
  const metadata = item.metadata && typeof item.metadata === "object"
    ? item.metadata as Record<string, unknown>
    : {};
  const existingPortfolioAssets = Array.isArray(metadata.portfolioAssets)
    ? metadata.portfolioAssets.filter((asset) => (
      asset && typeof asset === "object" && (asset as Record<string, unknown>).kind !== "body_image"
    ))
    : [];
  const existingReviewAssets = Array.isArray(item.content_review_assets)
    ? item.content_review_assets.filter((asset) => (
      asset && typeof asset === "object" && (asset as Record<string, unknown>).asset_type !== "body_image"
    ))
    : [];
  const manualAssets = TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => {
    const url = `${origin}/portfolio/manual/tourism-marketing/${asset.name}`;
    return {
      kind: "body_image",
      name: asset.name,
      url,
      caption: "원본 PowerPoint 폰트를 보존한 무가림 수동 확정 목업",
      slideIndexes: [...asset.slideIndexes],
      slideAspectRatio: 16 / 9,
      width: asset.width,
      height: asset.height,
      mockupMode: "short_psd",
      aspectClass: "16:9",
    };
  });
  return {
    ...item,
    content_review_assets: [
      ...existingReviewAssets,
      ...manualAssets.map((asset, index) => ({
        id: `manual-tourism-${index + 1}`,
        work_item_id: TOURISM_MARKETING_WORK_ITEM_ID,
        asset_type: "body_image",
        public_url: asset.url,
        sort_order: index + 1,
        approved: false,
        review_note: `${asset.caption} · 원본 슬라이드 ${asset.slideIndexes.map((value) => value + 1).join(", ")}`,
      })),
    ],
    metadata: {
      ...metadata,
      portfolioAssets: [...existingPortfolioAssets, ...manualAssets],
      portfolioMockup: {
        ...(metadata.portfolioMockup && typeof metadata.portfolioMockup === "object"
          ? metadata.portfolioMockup as Record<string, unknown>
          : {}),
        mode: "short_psd",
        bodyBoardCount: 4,
        aspectClass: "16:9",
        selectedSlideIndexes: TOURISM_MARKETING_MANUAL_ASSETS.flatMap((asset) => [...asset.slideIndexes]),
        manualFontPreservingOverride: true,
      },
      manualMockupOverride: {
        kind: "powerpoint_native_unredacted",
        appliedAt: "2026-08-05T20:45:00+09:00",
      },
    },
  };
}

type PortfolioJobRow = {
  id?: unknown;
  job_type?: unknown;
  status?: unknown;
  next_retry_at?: unknown;
  last_error_code?: unknown;
  updated_at?: unknown;
};

function validIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sanitizePortfolioJobs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const latestByType = new Map<string, {
    id: string;
    job_type: "mockup" | "draft";
    status: string;
    next_retry_at: string | null;
    last_error_code: string | null;
    updated_at: string;
  }>();

  for (const raw of value as PortfolioJobRow[]) {
    if (
      typeof raw.id !== "string"
      || !PORTFOLIO_JOB_TYPES.has(String(raw.job_type))
      || !PORTFOLIO_JOB_STATUSES.has(String(raw.status))
    ) continue;
    const updatedAt = validIsoDate(raw.updated_at);
    if (!updatedAt) continue;
    const jobType = raw.job_type as "mockup" | "draft";
    const current = latestByType.get(jobType);
    if (current && Date.parse(current.updated_at) >= Date.parse(updatedAt)) continue;
    const errorCode = typeof raw.last_error_code === "string"
      && /^[A-Z0-9_:-]{1,64}$/.test(raw.last_error_code)
      ? raw.last_error_code
      : null;
    latestByType.set(jobType, {
      id: raw.id.slice(0, 64),
      job_type: jobType,
      status: String(raw.status),
      next_retry_at: validIsoDate(raw.next_retry_at),
      last_error_code: errorCode,
      updated_at: updatedAt,
    });
  }

  return [...latestByType.values()];
}

/** 이 문서에 어울리는 표지 문구 후보를 만듭니다. AI를 부르지 않습니다. */
function portfolioCoverTitleSuggestions(
  metadata: unknown,
  history: CoverTitleRecord[],
) {
  const value = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const review = value.portfolioReview && typeof value.portfolioReview === "object"
    ? value.portfolioReview as Record<string, unknown>
    : {};
  const industry = typeof review.industry === "string" ? review.industry : null;
  const documentType = typeof review.documentType === "string" ? review.documentType : null;
  const clientCategory = typeof review.clientCategory === "string" ? review.clientCategory : null;
  return suggestCoverTitles({
    parts: {
      clientPrefix: clientCategory === "large_company" ? "대기업"
        : clientCategory === "public_institution" ? "공공기관" : null,
      subject: industry,
      documentType,
      projectName: typeof review.projectTitle === "string" ? review.projectTitle : null,
    },
    pastTitles: history,
    signature: coverTitleSignature({ industry, documentType, clientCategory }),
  });
}

export async function GET(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  let query = contentAdmin()
    .from("content_work_items")
    .select("*, content_review_assets(*), content_jobs(id,job_type,status,next_retry_at,last_error_code,updated_at)")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (channel) query = query.eq("channel", channel);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // 과거에 관리자가 고르거나 직접 쓴 표지 문구를 모읍니다.
  // 같은 성격의 문서에서 다시 추천되므로, 고치는 일이 점점 줄어듭니다.
  const coverTitleHistory = parseCoverTitleHistory(
    (data || [])
      .map((row) => (row.metadata as Record<string, unknown> | null)?.coverTitle)
      .filter(Boolean),
  ).sort((left, right) => right.savedAt.localeCompare(left.savedAt));

  const items = (data || []).map((rawItem) => {
    const item = applyHyundaiManualMockups(
      applyManualTourismMockups(rawItem, url.origin),
      url.origin,
    );
    const { content_jobs: contentJobs, ...safeItem } = item;
    const metadata = sanitizeWorkItemMetadata(item.metadata);
    return {
      ...safeItem,
      metadata,
      // 외주 작업실에 보이는지, 안 보이면 왜 안 보이는지를 같이 내려 줍니다.
      // 외주 화면과 완전히 같은 함수를 쓰므로 두 화면의 답이 갈리지 않습니다.
      ...(isPartnerChannel(item.channel)
        ? {
          partner_visibility: {
            blockers: partnerVisibilityBlockers({
              channel: String(item.channel),
              format: String(item.format),
              status: String(item.status),
              metadata: metadata as Parameters<typeof partnerVisibilityBlockers>[0]["metadata"],
            }),
          },
        }
        : {}),
      ...(item.format === "portfolio"
        ? {
          portfolio_jobs: sanitizePortfolioJobs(contentJobs),
          cover_title_suggestions: portfolioCoverTitleSuggestions(item.metadata, coverTitleHistory),
        }
        : {}),
    };
  });
  return NextResponse.json(items, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export async function POST(request: Request) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (!body.channel || !body.format || !body.title) {
    return NextResponse.json({ error: "채널, 형식, 제목은 필수입니다." }, { status: 400 });
  }
  if (body.status === "published") {
    return NextResponse.json({
      error: "발행 완료는 채널별 네이버 계정과 발행 URL을 서버에서 확인한 뒤에만 등록할 수 있습니다.",
    }, { status: 400 });
  }
  const status = CREATABLE_STATUSES.has(body.status) ? body.status as WorkflowStatus : "topic_candidate";
  const metadata = sanitizeWorkItemMetadata(body.metadata || {});
  if (body.format === "portfolio" && ["approved", "naver_ready", "scheduled"].includes(status)) {
    return NextResponse.json({
      error: "포트폴리오는 원본 변환·기밀 검사·현재 템플릿 생성을 완료한 기존 작업만 승인할 수 있습니다.",
    }, { status: 400 });
  }
  const { data, error } = await contentAdmin().from("content_work_items").insert({
    channel: body.channel,
    format: body.format,
    title: body.title,
    summary: body.summary || "",
    status,
    source_label: body.source_label || null,
    source_reference: body.source_reference || null,
    scheduled_at: body.scheduled_at || null,
    metadata,
    created_by: user.email,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
