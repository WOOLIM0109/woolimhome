import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import { validatePortfolioBodyHtml } from "@/lib/content-ops/portfolio-rules";
import type { WorkflowStatus } from "@/lib/content-ops/types";
import { parseStoredAssetUrl } from "@/lib/partner-portal";
import { rebuildPortfolioDraft } from "@/lib/portfolio/job-runner";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { resolveRevisionNote } from "@/lib/content-ops/generated-content";
import type { ContentChannel, ContentFormat, EditorialSlot } from "@/lib/content-ops/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const STATUSES: WorkflowStatus[] = [
  "topic_candidate", "researching", "creating", "review_required", "approved",
  "naver_ready", "scheduled", "published", "on_hold",
];

type RegeneratableItem = {
  id: string;
  channel: ContentChannel;
  format: ContentFormat;
  status: WorkflowStatus;
  schedule_key: string | null;
  scheduled_at: string | null;
  review_note: string | null;
  metadata: Record<string, unknown> | null;
};

function slotFor(item: RegeneratableItem): EditorialSlot {
  const slotKey = typeof item.metadata?.slotKey === "string" ? item.metadata.slotKey : null;
  const configured = EDITORIAL_SLOTS.find((slot) => slot.key === slotKey);
  if (configured) return configured;
  const scheduled = item.scheduled_at ? new Date(item.scheduled_at) : new Date();
  return {
    key: item.schedule_key || `revision-${item.id}`,
    channel: item.channel,
    format: item.format,
    weekday: scheduled.getDay(),
    hour: scheduled.getHours(),
    label: "수정 요청 재생성",
  };
}

async function regenerateContentItem(
  item: RegeneratableItem,
  requestedNote: unknown,
  forceNewTopic = false,
) {
  if (!item.schedule_key) throw new Error("재생성에 필요한 작업 키가 없습니다.");
  if (item.status === "published") throw new Error("이미 발행된 글은 자동으로 다시 만들 수 없습니다.");
  if (item.channel === "homepage") throw new Error("홈페이지 칼럼은 칼럼 관리자에서 수정해 주세요.");
  if (item.format === "portfolio") {
    throw new Error("포트폴리오는 ‘목업·본문 다시 만들기’를 이용해 주세요.");
  }

  const note = resolveRevisionNote(requestedNote, item.review_note, item.metadata);
  const metadata = {
    ...(item.metadata || {}),
    ...(note ? { pendingRevision: { note, requestedAt: new Date().toISOString() } } : {}),
  };
  const { error: startError } = await contentAdmin()
    .from("content_work_items")
    .update({
      status: "creating",
      review_note: note,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (startError) throw new Error(startError.message);

  try {
    return await generateContentWorkItem(slotFor(item), item.schedule_key, {
      revisionNote: note,
      forceNewTopic,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "자동 재생성 실패";
    if (message !== "GENERATION_CANCELLED") {
      await contentAdmin().from("content_work_items").update({
        status: "on_hold",
        review_note: `자동 재생성 보류: ${message}`,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  if (body.action === "regenerate" || body.action === "replace_topic" || body.status === "creating") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,channel,format,status,schedule_key,scheduled_at,review_note,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    try {
      return NextResponse.json(await regenerateContentItem(
        current as RegeneratableItem,
        body.review_note,
        body.action === "replace_topic",
      ));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "초안을 다시 만들지 못했습니다.",
      }, { status: 500 });
    }
  }
  if (body.action === "rebuild_portfolio") {
    try {
      return NextResponse.json(await rebuildPortfolioDraft(id));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "포트폴리오를 다시 만들지 못했습니다.",
      }, { status: 500 });
    }
  }
  if (body.status === "approved") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("format,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.format === "portfolio") {
      const generated = current.metadata?.generated as { bodyHtml?: string } | undefined;
      const issues = validatePortfolioBodyHtml(generated?.bodyHtml || "");
      if (issues.length) {
        return NextResponse.json(
          { error: `포트폴리오 기본 규칙을 확인해 주세요: ${issues.join(" ")}` },
          { status: 400 },
        );
      }
    }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.review_note === "string") patch.review_note = body.review_note;
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at || null;
  if (body.status === "published") patch.published_at = body.published_at || new Date().toISOString();

  const { data, error } = await contentAdmin()
    .from("content_work_items").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const admin = contentAdmin();
  const { data: item, error: itemError } = await admin
    .from("content_work_items")
    .select("id, title, status, content_review_assets(public_url)")
    .eq("id", id)
    .maybeSingle();

  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "삭제할 작업을 찾을 수 없습니다." }, { status: 404 });
  if (item.status === "published") {
    return NextResponse.json(
      { error: "이미 발행한 글은 기록 보호를 위해 관리자 화면에서 삭제할 수 없습니다." },
      { status: 409 },
    );
  }

  const { data: jobs, error: jobsReadError } = await admin
    .from("content_jobs")
    .select("candidate_id")
    .eq("work_item_id", id);
  if (jobsReadError) return NextResponse.json({ error: jobsReadError.message }, { status: 500 });

  const candidateIds = [...new Set(
    (jobs || []).map((job) => job.candidate_id).filter((value): value is string => Boolean(value)),
  )];
  if (candidateIds.length) {
    const { error: candidateError } = await admin
      .from("portfolio_candidates")
      .update({
        status: "excluded",
        exclusion_reasons: ["관리자가 자동화 작업 목록에서 삭제함"],
        updated_at: new Date().toISOString(),
      })
      .in("id", candidateIds);
    if (candidateError) return NextResponse.json({ error: candidateError.message }, { status: 500 });
  }

  const { error: jobsDeleteError } = await admin
    .from("content_jobs")
    .delete()
    .eq("work_item_id", id);
  if (jobsDeleteError) return NextResponse.json({ error: jobsDeleteError.message }, { status: 500 });

  const { error: deleteError } = await admin
    .from("content_work_items")
    .delete()
    .eq("id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const storedAssets = (item.content_review_assets || [])
    .map((asset) => parseStoredAssetUrl(asset.public_url))
    .filter((asset): asset is { bucket: string; path: string } => Boolean(asset));
  const storageWarnings: string[] = [];
  for (const bucket of [...new Set(storedAssets.map((asset) => asset.bucket))]) {
    const paths = storedAssets
      .filter((asset) => asset.bucket === bucket)
      .map((asset) => asset.path);
    if (!paths.length) continue;
    const { error: storageError } = await admin.storage.from(bucket).remove(paths);
    if (storageError) storageWarnings.push(storageError.message);
  }

  return NextResponse.json({
    id,
    title: item.title,
    deleted: true,
    storageWarnings,
  });
}
