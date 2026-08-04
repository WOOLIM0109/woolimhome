import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { sanitizeWorkItemMetadata } from "@/lib/security/html";
import type { WorkflowStatus } from "@/lib/content-ops/types";

export const dynamic = "force-dynamic";

const CREATABLE_STATUSES = new Set<WorkflowStatus>([
  "topic_candidate", "researching", "creating", "review_required", "approved",
  "naver_ready", "scheduled", "on_hold",
]);

const PORTFOLIO_JOB_TYPES = new Set(["mockup", "draft"]);
const PORTFOLIO_JOB_STATUSES = new Set([
  "queued", "running", "completed", "failed", "on_hold",
]);

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
  const items = (data || []).map((item) => {
    const { content_jobs: contentJobs, ...safeItem } = item;
    return {
      ...safeItem,
      metadata: sanitizeWorkItemMetadata(item.metadata),
      ...(item.format === "portfolio"
        ? { portfolio_jobs: sanitizePortfolioJobs(contentJobs) }
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
