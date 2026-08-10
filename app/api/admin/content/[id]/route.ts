import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import {
  validatePortfolioPublicationMetadata,
  validatePortfolioSourceState,
} from "@/lib/content-ops/portfolio-rules";
import type { WorkflowStatus } from "@/lib/content-ops/types";
import { parseStoredAssetUrl } from "@/lib/partner-portal";
import {
  PortfolioConversionRetryConflict,
  PortfolioDraftRecoveryUnavailable,
  PortfolioManualAssetsPresent,
  PortfolioRebuildConflict,
  rebuildPortfolioDraft,
  rebuildPortfolioMockupsOnly,
  reflowPortfolioDraftImages,
  restorePortfolioDraft,
  retryPortfolioConversion,
  retryPortfolioDraft,
} from "@/lib/portfolio/job-runner";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { generateContentWorkItem } from "@/lib/content-ops/generate";
import { geminiRuntimeStatus } from "@/lib/gemini/protection";
import { GeminiAutomationBlocked, runBudgetedGeminiAutomation } from "@/lib/gemini/automation";
import { resolveRevisionNote } from "@/lib/content-ops/generated-content";
import { sanitizeGeneratedHtml } from "@/lib/security/html";
import {
  coverTitleRecord,
  coverTitleSignature,
  normalizeCoverTitle,
} from "@/lib/portfolio/cover-title";
import type { ContentChannel, ContentFormat, EditorialSlot } from "@/lib/content-ops/types";
import { retryMissingFontCandidates } from "@/lib/pc-worker/font-retry";
import { geminiRetryDecision } from "@/lib/gemini/client";
import { editorialPublicationIssues } from "@/lib/content-ops/editorial-policy";
import {
  correctHyundaiManualContentMetadata,
  HYUNDAI_MANUAL_MOCKUP_TITLE,
  isHyundaiManualMockupTitle,
  hyundaiManualApprovalMetadata,
} from "@/lib/portfolio/hyundai-manual-mockups";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOURISM_MARKETING_WORK_ITEM_ID = "6579c77c-86fd-4b6a-9e65-654394597c8f";
const TOURISM_MARKETING_MANUAL_ASSETS = [
  { name: "short-main.jpg", slideIndexes: [2, 4, 5, 9, 10], width: 1600, height: 1600 },
  { name: "short-detail-1.jpg", slideIndexes: [0, 1, 3], width: 1600, height: 900 },
  { name: "short-detail-2.jpg", slideIndexes: [6, 7, 8], width: 1600, height: 900 },
  { name: "short-detail-3.jpg", slideIndexes: [11, 12, 13], width: 1600, height: 900 },
] as const;

function tourismManualApprovalMetadata(
  id: string,
  metadata: Record<string, unknown> | null,
  origin: string,
  approvedBy: string,
) {
  if (id !== TOURISM_MARKETING_WORK_ITEM_ID) return null;
  const value = metadata || {};
  const generated = value.generated && typeof value.generated === "object"
    ? value.generated as { bodyHtml?: unknown }
    : {};
  const bodyHtml = typeof generated.bodyHtml === "string" ? generated.bodyHtml : "";
  const imageSources = [...bodyHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  const expectedUrls = TOURISM_MARKETING_MANUAL_ASSETS.map(
    (asset) => `${origin}/portfolio/manual/tourism-marketing/${asset.name}`,
  );
  const figureCount = (bodyHtml.match(/<figure[\s>]/gi) || []).length;
  if (figureCount !== expectedUrls.length
    || imageSources.length !== expectedUrls.length
    || [...imageSources].sort().some((url, index) => url !== [...expectedUrls].sort()[index])) {
    return null;
  }

  const previousAssets = Array.isArray(value.portfolioAssets)
    ? value.portfolioAssets.filter((asset) => (
      asset && typeof asset === "object" && (asset as Record<string, unknown>).kind !== "body_image"
    ))
    : [];
  const manualAssets = TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => ({
    kind: "body_image" as const,
    name: asset.name,
    url: `${origin}/portfolio/manual/tourism-marketing/${asset.name}`,
    caption: "원본 PowerPoint의 글꼴과 배치를 유지한 수동 확정 목업",
    slideIndexes: [...asset.slideIndexes],
    slideAspectRatio: 16 / 9,
    width: asset.width,
    height: asset.height,
    mockupMode: "short_psd" as const,
    aspectClass: "16:9" as const,
  }));
  const approvedAt = new Date().toISOString();
  return {
    ...value,
    portfolioAssets: [...previousAssets, ...manualAssets],
    portfolioMockup: {
      ...(value.portfolioMockup && typeof value.portfolioMockup === "object"
        ? value.portfolioMockup as Record<string, unknown>
        : {}),
      mode: "short_psd",
      bodyBoardCount: 4,
      aspectClass: "16:9",
      selectedSlideIndexes: TOURISM_MARKETING_MANUAL_ASSETS.flatMap((asset) => [...asset.slideIndexes]),
      manualFontPreservingOverride: true,
    },
    manualMockupOverride: {
      kind: "powerpoint_native_unredacted",
      approvedAt,
      approvedBy,
      assetNames: TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => asset.name),
    },
  };
}

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
      const retry = geminiRetryDecision(error, 0);
      await contentAdmin().from("content_work_items").update({
        status: "on_hold",
        review_note: `자동 재생성 보류: ${message}`,
        retry_count: retry.retryCount,
        next_retry_at: retry.nextRetryAt,
        last_error_code: retry.code,
        last_error_context: { source: "admin_regenerate", at: new Date().toISOString() },
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
  const protectedAiAction = body.action === "regenerate"
    || body.action === "replace_topic"
    || body.action === "rebuild_portfolio"
    || body.action === "retry_portfolio_draft"
    || body.status === "creating";
  // 이전에는 이 지점에서 무조건 막았기 때문에 환경변수를 켜도 열리지 않았습니다.
  // 이제는 잠금 상태와 남은 예산을 실제로 확인해서 판단합니다.
  if (protectedAiAction) {
    const runtime = geminiRuntimeStatus();
    if (!runtime.enabled) {
      return NextResponse.json({
        error: runtime.reason || "Gemini 호출이 잠겨 있습니다.",
        code: "GEMINI_DISABLED",
        aiCalls: 0,
        nextAction: "Vercel 환경변수에서 GEMINI_ENABLED 를 확인해 주세요.",
      }, { status: 409 });
    }
  }
  let expectedUpdatedAt: string | null = null;
  let approvedMetadata: Record<string, unknown> | null = null;
  if (body.status === "published") {
    return NextResponse.json({
      error: "발행 완료는 파트너 발행 완료 등록 화면에서 네이버 게시물 URL을 입력해 처리해 주세요.",
    }, { status: 400 });
  }
  // 표지 문구를 고르거나 직접 써서 저장합니다. AI를 부르지 않습니다.
  // 저장된 문구는 다음 목업 생성에 그대로 쓰이고, 같은 성격의 다른 문서 추천에도 반영됩니다.
  if (body.action === "set_cover_title") {
    const title = normalizeCoverTitle(body.coverTitle);
    if (!title) {
      return NextResponse.json({ error: "표지 문구는 2자 이상 40자 이하로 입력해 주세요." }, { status: 400 });
    }
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    const metadata = (current.metadata || {}) as Record<string, unknown>;
    const review = metadata.portfolioReview && typeof metadata.portfolioReview === "object"
      ? metadata.portfolioReview as Record<string, unknown>
      : {};
    const signature = coverTitleSignature({
      industry: typeof review.industry === "string" ? review.industry : null,
      documentType: typeof review.documentType === "string" ? review.documentType : null,
      clientCategory: typeof review.clientCategory === "string" ? review.clientCategory : null,
    });
    const savedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await contentAdmin()
      .from("content_work_items")
      .update({
        metadata: {
          ...metadata,
          coverTitle: coverTitleRecord(
            title,
            body.chosenFromSuggestion === true ? "selected" : "manual",
            signature,
            savedAt,
          ),
        },
        updated_at: savedAt,
      })
      .eq("id", id)
      .eq("updated_at", current.updated_at)
      .select("id")
      .maybeSingle();
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    if (!saved) {
      return NextResponse.json({
        error: "저장하는 동안 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
      }, { status: 409 });
    }
    return NextResponse.json({
      id: saved.id,
      coverTitle: title,
      note: "표지 이미지에 반영하려면 '본문 유지·목업 이미지만 재생성'을 눌러 주세요.",
    });
  }

  // 사람이 직접 고쳐 저장합니다. AI를 부르지 않으므로 요금이 들지 않고 즉시 반영됩니다.
  // 기존 '수정 요청'은 전체 재생성이라 오래 걸리고 결과를 예측할 수 없었습니다.
  if (body.action === "manual_edit") {
    const nextTitle = typeof body.title === "string" ? body.title.trim() : "";
    const nextBodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
    if (!nextTitle || !nextBodyHtml.trim()) {
      return NextResponse.json({ error: "제목과 본문을 모두 입력해 주세요." }, { status: 400 });
    }
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,format,status,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.status === "published") {
      return NextResponse.json({ error: "이미 발행한 글은 여기서 고칠 수 없습니다." }, { status: 409 });
    }
    const metadata = (current.metadata || {}) as Record<string, unknown>;
    const generated = metadata.generated && typeof metadata.generated === "object"
      ? metadata.generated as Record<string, unknown>
      : null;
    if (!generated) {
      return NextResponse.json({ error: "고칠 원고가 아직 없습니다." }, { status: 409 });
    }
    const cleanBody = sanitizeGeneratedHtml(nextBodyHtml);
    const plainLength = cleanBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, "").length;
    const nextGenerated = { ...generated, title: nextTitle, bodyHtml: cleanBody };
    const appliedAt = new Date().toISOString();
    const validation = metadata.validation && typeof metadata.validation === "object"
      ? metadata.validation as Record<string, unknown>
      : {};
    const { data: saved, error: saveError } = await contentAdmin()
      .from("content_work_items")
      .update({
        title: nextTitle,
        // 사람이 직접 고쳤으므로 자동 검증에서 걸렸던 보류 사유는 지웁니다.
        review_note: null,
        status: current.status === "on_hold" ? "review_required" : current.status,
        metadata: {
          ...metadata,
          generated: nextGenerated,
          validation: {
            ...validation,
            plainLength,
            h2Count: (cleanBody.match(/<h2[\s>]/gi) || []).length,
            issues: [],
          },
          manualEdit: { appliedAt, appliedBy: user.email || "admin" },
        },
        updated_at: appliedAt,
      })
      .eq("id", id)
      .eq("updated_at", current.updated_at)
      .select("id,status")
      .maybeSingle();
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    if (!saved) {
      return NextResponse.json({
        error: "저장하는 동안 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
      }, { status: 409 });
    }
    return NextResponse.json({ id: saved.id, status: saved.status, manualEdit: true, plainLength });
  }

  if (body.action === "regenerate" || body.action === "replace_topic" || body.status === "creating") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,channel,format,status,schedule_key,scheduled_at,review_note,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    try {
      return NextResponse.json(await runBudgetedGeminiAutomation({
        operation: body.action === "replace_topic" ? "content-replace-topic" : "content-regenerate",
        actor: user.email || "admin",
        // 주제가 그대로인 수정이면 저장해 둔 조사 결과를 다시 쓰므로 호출이 더 적습니다.
        plannedCalls: body.action === "replace_topic" ? 6 : 4,
      }, () => regenerateContentItem(
        current as RegeneratableItem,
        body.review_note,
        body.action === "replace_topic",
      )));
    } catch (error) {
      if (error instanceof GeminiAutomationBlocked) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return NextResponse.json({
        error: error instanceof Error ? error.message : "초안을 다시 만들지 못했습니다.",
      }, { status: 500 });
    }
  }
  if (body.action === "rebuild_portfolio") {
    try {
      return NextResponse.json(await rebuildPortfolioDraft(id, {
        // 화면에서 '수동 이미지 버리고 다시 만들기'를 선택했을 때만 true 가 옵니다.
        discardManualAssets: body.discardManualAssets === true,
      }));
    } catch (error) {
      if (error instanceof PortfolioManualAssetsPresent) {
        return NextResponse.json({
          error: error.message,
          code: error.code,
          requiresConfirmation: "discardManualAssets",
        }, { status: 409 });
      }
      return NextResponse.json({
        error: error instanceof Error ? error.message : "포트폴리오를 다시 만들지 못했습니다.",
      }, {
        status: error instanceof PortfolioRebuildConflict
          || error instanceof PortfolioConversionRetryConflict
          ? 409
          : 500,
      });
    }
  }
  if (body.action === "retry_portfolio_conversion") {
    try {
      return NextResponse.json(await retryPortfolioConversion(id));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "원본 PPT 변환을 다시 요청하지 못했습니다.",
      }, { status: error instanceof PortfolioConversionRetryConflict ? 409 : 500 });
    }
  }
  if (body.action === "retry_portfolio_draft") {
    try {
      const result = await runBudgetedGeminiAutomation({
        operation: "portfolio-draft-retry",
        actor: user.email || "admin",
        plannedCalls: 3,
      }, () => retryPortfolioDraft(id));
      if (!result) {
        return NextResponse.json({ error: "다시 생성할 포트폴리오 본문 작업을 찾지 못했습니다." }, { status: 409 });
      }
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof GeminiAutomationBlocked) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return NextResponse.json({
        error: error instanceof Error ? error.message : "포트폴리오 본문을 다시 만들지 못했습니다.",
      }, { status: 500 });
    }
  }
  if (body.action === "restore_portfolio_draft") {
    try {
      const origin = new URL(request.url).origin;
      const bodyAssets = id === TOURISM_MARKETING_WORK_ITEM_ID
        ? TOURISM_MARKETING_MANUAL_ASSETS.map((asset) => ({
          kind: "body_image" as const,
          name: asset.name,
          url: `${origin}/portfolio/manual/tourism-marketing/${asset.name}`,
          caption: "원본 PowerPoint의 글꼴과 배치를 유지한 수동 확정 목업",
          slideIndexes: [...asset.slideIndexes],
          slideAspectRatio: 16 / 9,
          width: asset.width,
          height: asset.height,
          mockupMode: "short_psd" as const,
          aspectClass: "16:9" as const,
        }))
        : undefined;
      return NextResponse.json(await restorePortfolioDraft(id, { bodyAssets }));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "기존 포트폴리오 본문을 복구하지 못했습니다.",
      }, {
        status: error instanceof PortfolioDraftRecoveryUnavailable ? 409 : 500,
      });
    }
  }
  if (body.action === "reflow_portfolio_images") {
    try {
      return NextResponse.json(await reflowPortfolioDraftImages(id));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "본문 이미지 배치를 정리하지 못했습니다.",
      }, { status: error instanceof PortfolioDraftRecoveryUnavailable ? 409 : 500 });
    }
  }
  if (body.action === "rebuild_portfolio_mockups") {
    try {
      return NextResponse.json(await rebuildPortfolioMockupsOnly(id));
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "포트폴리오 목업 이미지를 다시 만들지 못했습니다.",
      }, {
        status: error instanceof PortfolioRebuildConflict
          || error instanceof PortfolioConversionRetryConflict
          ? 409
          : 500,
      });
    }
  }
  if (body.action === "retry_missing_fonts") {
    const admin = contentAdmin();
    const [{ data: jobs, error: jobsError }, { data: worker, error: workerError }] = await Promise.all([
      admin.from("content_jobs").select("candidate_id").eq("work_item_id", id).eq("job_type", "convert"),
      admin.from("content_workers")
        .select("font_inventory_fingerprint,last_seen_at")
        .not("font_inventory_fingerprint", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (jobsError || workerError) {
      return NextResponse.json({ error: jobsError?.message || workerError?.message }, { status: 500 });
    }
    if (!worker?.font_inventory_fingerprint) {
      return NextResponse.json({ error: "글꼴 목록을 보고한 사무실 PC가 없습니다. PC 워커 상태를 먼저 확인해 주세요." }, { status: 409 });
    }
    const candidateIds = [...new Set((jobs || []).map((job) => job.candidate_id).filter(Boolean))];
    let requeued = 0;
    for (const candidateId of candidateIds) {
      const result = await retryMissingFontCandidates(worker.font_inventory_fingerprint, candidateId, true);
      requeued += result.requeued;
    }
    if (!requeued) {
      return NextResponse.json({ error: "다시 처리할 누락 글꼴 작업을 찾지 못했습니다." }, { status: 409 });
    }
    return NextResponse.json({ success: true, requeued });
  }
  if (body.action === "release_to_partner") {
    const admin = contentAdmin();
    const { data: current, error: currentError } = await admin
      .from("content_work_items")
      .select("format,status,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.format === "portfolio" || current.status === "published") {
      return NextResponse.json({ error: "이 원고는 별도 외주 전달 승인이 필요하지 않습니다." }, { status: 400 });
    }
    const generated = current.metadata?.generated;
    const editorialIssues = editorialPublicationIssues(current.format, generated);
    if (editorialIssues.length) {
      return NextResponse.json({
        error: `원고 규칙을 먼저 정리해 주세요: ${editorialIssues.join(" ")}`,
        details: { issues: editorialIssues },
      }, { status: 400 });
    }
    const now = new Date().toISOString();
    const metadata = {
      ...(current.metadata || {}),
      partnerReleaseOverride: {
        approvedAt: now,
        approvedBy: user.email || "admin",
      },
    };
    const { data, error } = await admin.from("content_work_items").update({
      status: "approved",
      metadata,
      updated_at: now,
    }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  if (body.action === "correct_hyundai_content") {
    const admin = contentAdmin();
    const { data: current, error: currentError } = await admin
      .from("content_work_items")
      .select("format,title,metadata,status")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.format !== "portfolio" || !isHyundaiManualMockupTitle(current.title)) {
      return NextResponse.json({ error: "해당 생활폐기물 입찰제안서 작업을 찾지 못했습니다." }, { status: 404 });
    }
    if (current.status === "published") {
      return NextResponse.json({ error: "이미 발행한 글은 자동으로 수정할 수 없습니다." }, { status: 409 });
    }
    const correctedMetadata = correctHyundaiManualContentMetadata(
      current.metadata,
      new URL(request.url).origin,
    );
    if (!correctedMetadata) {
      return NextResponse.json({ error: "생활폐기물 입찰제안서 본문을 정정하지 못했습니다." }, { status: 409 });
    }
    const generated = correctedMetadata.generated as { summary?: unknown };
    const summary = typeof generated.summary === "string" ? generated.summary : "";
    const { data, error } = await admin.from("content_work_items").update({
      title: HYUNDAI_MANUAL_MOCKUP_TITLE,
      summary,
      review_note: "원본 PPT를 기준으로 생활폐기물 수집·운반 대행용역 입찰제안서 내용으로 정정했습니다.",
      metadata: correctedMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  if (["approved", "naver_ready", "scheduled"].includes(String(body.status || ""))) {
    const admin = contentAdmin();
    const { data: current, error: currentError } = await admin
      .from("content_work_items")
      .select("format,title,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    expectedUpdatedAt = current.updated_at;
    if (current.format === "portfolio") {
      approvedMetadata = tourismManualApprovalMetadata(
        id,
        current.metadata,
        new URL(request.url).origin,
        user.email || "admin",
      ) || hyundaiManualApprovalMetadata(
        current.title,
        current.metadata,
        new URL(request.url).origin,
        user.email || "admin",
      );
      const [mockupJobQuery, conversionJobQuery, draftJobQuery] = await Promise.all([
        admin.from("content_jobs")
          .select("status,result")
          .eq("work_item_id", id)
          .eq("job_type", "mockup")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("content_jobs")
          .select("status,result,updated_at")
          .eq("work_item_id", id)
          .eq("job_type", "convert")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("content_jobs")
          .select("status,result")
          .eq("work_item_id", id)
          .eq("job_type", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (mockupJobQuery.error || conversionJobQuery.error || draftJobQuery.error) {
        return NextResponse.json({
          error: mockupJobQuery.error?.message
            || conversionJobQuery.error?.message
            || draftJobQuery.error?.message,
        }, { status: 500 });
      }
      const issues = approvedMetadata ? [] : [
        ...validatePortfolioPublicationMetadata(current.metadata),
        ...validatePortfolioSourceState(
          current.metadata,
          mockupJobQuery.data,
          conversionJobQuery.data,
          draftJobQuery.data,
        ),
      ];
      if (issues.length) {
        return NextResponse.json(
          { error: `포트폴리오 기본 규칙을 확인해 주세요: ${issues.join(" ")}` },
          { status: 400 },
        );
      }
    }
    const editorialIssues = editorialPublicationIssues(
      current.format,
      current.metadata?.generated,
    );
    if (editorialIssues.length) {
      return NextResponse.json({
        error: `원고 규칙을 먼저 정리해 주세요: ${editorialIssues.join(" ")}`,
        details: { issues: editorialIssues },
      }, { status: 400 });
    }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.review_note === "string") patch.review_note = body.review_note;
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (approvedMetadata) patch.metadata = approvedMetadata;
  if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at || null;
  if (body.status === "published") patch.published_at = body.published_at || new Date().toISOString();

  let updateQuery = contentAdmin().from("content_work_items").update(patch).eq("id", id);
  if (expectedUpdatedAt) updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await updateQuery.select().single();
  if (error?.code === "PGRST116" && expectedUpdatedAt) {
    return NextResponse.json({
      error: "승인 직전에 원본 또는 목업 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.",
    }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  // 발행 완료 항목은 기본적으로 보호하되, 화면에서 한 번 더 확인하면 지울 수 있게 합니다.
  // 중복 등록된 발행 기록을 정리할 방법이 없어 외주 작업실이 막히는 일이 있었습니다.
  const confirmPublishedDelete = new URL(request.url).searchParams.get("confirmPublished") === "1";
  const admin = contentAdmin();
  const { data: item, error: itemError } = await admin
    .from("content_work_items")
    .select("id, title, status, content_review_assets(public_url)")
    .eq("id", id)
    .maybeSingle();

  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "삭제할 작업을 찾을 수 없습니다." }, { status: 404 });
  if (item.status === "published" && !confirmPublishedDelete) {
    return NextResponse.json(
      {
        error: "이미 발행한 글입니다. 그래도 지우시려면 확인 후 다시 시도해 주세요.",
        code: "PUBLISHED_DELETE_CONFIRM_REQUIRED",
        requiresConfirmation: "confirmPublished",
      },
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
