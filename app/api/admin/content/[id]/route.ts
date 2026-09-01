import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import {
  validatePortfolioPublicationMetadata,
  validatePortfolioSourceState,
} from "@/lib/content-ops/portfolio-rules";
import type { WorkflowStatus } from "@/lib/content-ops/types";
import { appendStatusChange } from "@/lib/content-ops/status-history";
import { isPartnerChannel, parseStoredAssetUrl, partnerVisibilityBlockers } from "@/lib/partner-portal";
import { validateNaverPublication } from "@/lib/publication";
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
import {
  DraftRevisionUnavailable,
  plannedRevisionCalls,
  reviseWorkItemDraft,
} from "@/lib/content-ops/revise-draft";
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
import {
  isTourismMarketingWorkItem,
  TOURISM_MANUAL_ASSET_NAMES,
  tourismManualAssetUrls,
  tourismManualBodyAssets,
  tourismManualMockupFields,
  withoutGeneratedBodyImages,
} from "@/lib/portfolio/manual-overrides";

export const runtime = "nodejs";
export const maxDuration = 300;

function tourismManualApprovalMetadata(
  id: string,
  metadata: Record<string, unknown> | null,
  origin: string,
  approvedBy: string,
) {
  if (!isTourismMarketingWorkItem(id)) return null;
  const value = metadata || {};
  const generated = value.generated && typeof value.generated === "object"
    ? value.generated as { bodyHtml?: unknown }
    : {};
  const bodyHtml = typeof generated.bodyHtml === "string" ? generated.bodyHtml : "";
  const imageSources = [...bodyHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  const expectedUrls = tourismManualAssetUrls(origin);
  const figureCount = (bodyHtml.match(/<figure[\s>]/gi) || []).length;
  if (figureCount !== expectedUrls.length
    || imageSources.length !== expectedUrls.length
    || [...imageSources].sort().some((url, index) => url !== [...expectedUrls].sort()[index])) {
    return null;
  }

  const previousAssets = withoutGeneratedBodyImages(value.portfolioAssets);
  const manualAssets = tourismManualBodyAssets(
    origin,
    "원본 PowerPoint의 글꼴과 배치를 유지한 수동 확정 목업",
  );
  const approvedAt = new Date().toISOString();
  return {
    ...value,
    portfolioAssets: [...previousAssets, ...manualAssets],
    portfolioMockup: tourismManualMockupFields(value.portfolioMockup),
    manualMockupOverride: {
      kind: "powerpoint_native_unredacted",
      approvedAt,
      approvedBy,
      assetNames: TOURISM_MANUAL_ASSET_NAMES,
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
  // 누가 다시 만들라고 했는지 단계 기록에 남깁니다.
  actor = "admin",
) {
  if (!item.schedule_key) throw new Error("재생성에 필요한 작업 키가 없습니다.");
  if (item.status === "published") throw new Error("이미 발행된 글은 자동으로 다시 만들 수 없습니다.");
  if (item.channel === "homepage") throw new Error("홈페이지 칼럼은 칼럼 관리자에서 수정해 주세요.");
  if (item.format === "portfolio") {
    throw new Error("포트폴리오는 ‘목업·본문 다시 만들기’를 이용해 주세요.");
  }

  const note = resolveRevisionNote(requestedNote, item.review_note, item.metadata);
  const metadata = appendStatusChange({
    ...(item.metadata || {}),
    ...(note ? { pendingRevision: { note, requestedAt: new Date().toISOString() } } : {}),
  }, "creating", actor);
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
        metadata: appendStatusChange(item.metadata, "on_hold", actor),
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
    // 요청사항 반영도 Gemini 를 부릅니다. 예산과 잠금을 똑같이 거쳐야 합니다.
    || body.action === "revise_draft"
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
  // 승인 직전 상태와 metadata 를 기억해 둡니다.
  // 보류였던 작업을 바로 승인할 때 예전 보류 기록을 정리하는 데 씁니다.
  let editorialOverride: Record<string, unknown> | null = null;
  let statusBeforeChange: string | null = null;
  let metadataBeforeChange: Record<string, unknown> | null = null;
  if (body.status === "published") {
    return NextResponse.json({
      error: "발행 완료는 파트너 발행 완료 등록 화면에서 네이버 게시물 URL을 입력해 처리해 주세요.",
    }, { status: 400 });
  }
  // 관리자가 발행 완료를 직접 등록합니다.
  // 지금까지는 외주 작업실에서만 가능해, 작가가 등록하지 못하면 승인 완료에 머물렀습니다.
  // 검증과 중복 확인은 외주 화면과 똑같이 거칩니다.
  if (body.action === "mark_published") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,channel,status,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!isPartnerChannel(current.channel)) {
      return NextResponse.json({
        error: "네이버 블로그 채널만 발행 완료로 등록할 수 있습니다.",
      }, { status: 400 });
    }
    if (current.status === "published") {
      return NextResponse.json({ error: "이미 발행 완료로 등록된 작업입니다." }, { status: 409 });
    }
    const validation = validateNaverPublication({
      channel: current.channel,
      publishedUrl: body.publishedUrl,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }
    const { data: conflict } = await contentAdmin()
      .from("content_work_items")
      .select("id,title,status")
      .eq("published_url_normalized", validation.publication.normalizedUrl)
      .neq("id", id)
      .maybeSingle();
    if (conflict) {
      return NextResponse.json({
        error: `이 주소는 이미 다른 작업(${conflict.title})에 등록되어 있습니다.`,
        code: "PUBLISHED_URL_CONFLICT",
        details: { conflictItemId: conflict.id, conflictStatus: conflict.status },
      }, { status: 409 });
    }
    const completedAt = new Date().toISOString();
    const metadata = (current.metadata || {}) as Record<string, unknown>;
    const { data: saved, error: saveError } = await contentAdmin()
      .from("content_work_items")
      .update({
        status: "published",
        published_at: completedAt,
        published_url: validation.publication.normalizedUrl,
        published_url_normalized: validation.publication.normalizedUrl,
        published_account: validation.publication.account,
        metadata: {
          ...appendStatusChange(metadata, "published", user.email || "admin", completedAt),
          partnerHandoff: {
            publishedUrl: validation.publication.normalizedUrl,
            publishedAccount: validation.publication.account,
            completedAt,
            completedBy: user.email,
            registeredFrom: "admin",
          },
        },
        updated_at: completedAt,
      })
      .eq("id", id)
      .eq("updated_at", current.updated_at)
      .select("id,status,published_at")
      .maybeSingle();
    if (saveError?.code === "23505") {
      return NextResponse.json({
        error: "이 주소는 이미 다른 작업에 등록되어 있습니다.",
        code: "PUBLISHED_URL_CONFLICT",
      }, { status: 409 });
    }
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    if (!saved) {
      return NextResponse.json({
        error: "등록하는 동안 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
      }, { status: 409 });
    }
    return NextResponse.json(saved);
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
  /**
   * 보류 해제
   *
   * 목업 이미지를 다시 만들어도 예전 보류 상태는 그대로 되살아납니다.
   * 이미지가 문제였던 경우에는 사람이 눈으로 확인한 뒤 직접 풀어야 하는데,
   * 지금까지는 본문을 고치는 방법밖에 없어서 고칠 게 없으면 계속 보류로 남았습니다.
   * AI를 부르지 않고 검토 대기로만 옮깁니다.
   */
  if (body.action === "clear_hold") {
    const { data: current, error: currentError } = await contentAdmin()
      .from("content_work_items")
      .select("id,status,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (current.status !== "on_hold") {
      return NextResponse.json({ error: "보류 상태인 작업만 해제할 수 있습니다." }, { status: 409 });
    }
    const metadata = (current.metadata || {}) as Record<string, unknown>;
    const validation = metadata.validation && typeof metadata.validation === "object"
      ? metadata.validation as Record<string, unknown>
      : {};
    const clearedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await contentAdmin()
      .from("content_work_items")
      .update({
        status: "review_required",
        review_note: null,
        metadata: {
          ...appendStatusChange(metadata, "review_required", user.email || "admin", clearedAt),
          validation: { ...validation, issues: [] },
          // 누가 언제 어떤 사유를 보고 풀었는지 남겨 둡니다.
          holdCleared: {
            clearedAt,
            clearedBy: user.email || "admin",
            previousNote: typeof metadata.lastReviewNote === "string" ? metadata.lastReviewNote : null,
          },
          // 목업만 다시 만들 때 예전 보류 상태가 되살아나지 않게 함께 정리합니다.
          mockupOnlyRestoreState: null,
        },
        updated_at: clearedAt,
      })
      .eq("id", id)
      .eq("updated_at", current.updated_at)
      .select("id,status")
      .maybeSingle();
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
    if (!saved) {
      return NextResponse.json({
        error: "해제하는 동안 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
      }, { status: 409 });
    }
    return NextResponse.json({ id: saved.id, status: saved.status, holdCleared: true });
  }

  /**
   * 사람이 남긴 요청사항을 인공지능이 기존 원고에 반영합니다.
   *
   * 예전에는 '수정 요청'이 글을 처음부터 다시 쓰는 버튼이었고, 포트폴리오에서는
   * 그마저 막혀 있어 목업 이미지까지 다시 만들라는 안내만 나왔습니다.
   * 여기서는 목업에 손대지 않고 본문만 고칩니다.
   */
  if (body.action === "revise_draft") {
    try {
      const result = await runBudgetedGeminiAutomation({
        operation: "content-revise-draft",
        actor: user.email || "admin",
        // 소제목 단위로 한 덩이씩 맡기므로, 덩이 수가 곧 호출 수입니다.
        plannedCalls: await plannedRevisionCalls(id),
      }, () => reviseWorkItemDraft(id, body.review_note, user.email || "admin"));
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof GeminiAutomationBlocked) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      if (error instanceof DraftRevisionUnavailable) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return NextResponse.json({
        error: error instanceof Error ? error.message : "요청사항을 반영하지 못했습니다.",
      }, { status: 500 });
    }
  }

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
        user.email || "admin",
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
      const bodyAssets = isTourismMarketingWorkItem(id)
        ? tourismManualBodyAssets(origin, "원본 PowerPoint의 글꼴과 배치를 유지한 수동 확정 목업")
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
      .select("channel,format,status,metadata")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!isPartnerChannel(current.channel)) {
      return NextResponse.json({ error: "네이버 채널 작업만 외주 작업실로 보낼 수 있습니다." }, { status: 400 });
    }
    if (current.status === "published") {
      return NextResponse.json({ error: "이미 발행한 작업은 외주 작업실에 그대로 남아 있습니다." }, { status: 400 });
    }
    // 규칙에 걸린 원고라도 관리자가 판단하면 보낼 수 있게 합니다.
    // 막아 두면 작업이 아무 표시 없이 사라진 상태가 그대로 굳어집니다.
    // 대신 어떤 사유를 넘겼는지 기록해 나중에 확인할 수 있게 남깁니다.
    const overriddenReasons = partnerVisibilityBlockers({
      channel: String(current.channel),
      format: String(current.format),
      // 상태 사유는 아래에서 승인으로 바꾸므로 판단에서 제외합니다.
      status: "approved",
      metadata: current.metadata,
    }).map((blocker) => blocker.message);
    const now = new Date().toISOString();
    const metadata = {
      ...appendStatusChange(current.metadata, "approved", user.email || "admin", now),
      partnerReleaseOverride: {
        approvedAt: now,
        approvedBy: user.email || "admin",
        overriddenReasons,
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
      .select("format,title,status,metadata,updated_at")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    expectedUpdatedAt = current.updated_at;
    statusBeforeChange = typeof current.status === "string" ? current.status : null;
    metadataBeforeChange = (current.metadata || null) as Record<string, unknown> | null;
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
    /**
     * 문체 규칙은 사람이 판단해 넘길 수 있게 합니다.
     *
     * 기밀 가림과 발행 검증은 넘길 수 없지만, 문체는 취향과 판단의 영역입니다.
     * 막아 두기만 하면 내용이 좋은 원고도 승인할 방법이 없어 작업이 멈춥니다.
     * 대신 누가 어떤 사유를 넘겼는지 기록을 남깁니다.
     */
    if (editorialIssues.length && body.overrideEditorial !== true) {
      return NextResponse.json({
        error: `원고 규칙을 먼저 정리해 주세요: ${editorialIssues.join(" ")}`,
        details: { issues: editorialIssues, canOverride: true },
      }, { status: 400 });
    }
    if (editorialIssues.length && body.overrideEditorial === true) {
      editorialOverride = {
        approvedAt: new Date().toISOString(),
        approvedBy: user.email || "admin",
        overriddenIssues: editorialIssues,
      };
    }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.review_note === "string") patch.review_note = body.review_note;
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (approvedMetadata) patch.metadata = approvedMetadata;
  // 보류였던 작업을 바로 승인하면 예전 보류 사유와 복원 표시를 함께 정리합니다.
  // 남겨 두면 목업을 다시 만들 때 보류 상태가 되살아납니다.
  if (editorialOverride) {
    const baseMetadata = (patch.metadata as Record<string, unknown> | undefined)
      || metadataBeforeChange
      || {};
    patch.metadata = { ...baseMetadata, editorialOverride };
  }
  if (body.status === "approved" && statusBeforeChange === "on_hold") {
    patch.review_note = null;
    const baseMetadata = (patch.metadata as Record<string, unknown> | undefined)
      || metadataBeforeChange
      || {};
    patch.metadata = { ...baseMetadata, mockupOnlyRestoreState: null };
  }
  /*
   * 상태가 바뀌면 여기서 한 줄 남깁니다.
   *
   * 위의 특별한 길(발행·보류해제·외주승인)도 각자 남기지만, 검토 화면에서
   * 누르는 승인·보류는 전부 이 자리를 지납니다. 한 곳이라도 빠뜨리면
   * 기록에 구멍이 나고, 구멍 난 기록은 아무도 믿지 않게 됩니다.
   */
  if (patch.status) {
    const baseMetadata = (patch.metadata as Record<string, unknown> | undefined)
      || metadataBeforeChange
      || {};
    patch.metadata = appendStatusChange(baseMetadata, patch.status as WorkflowStatus, user.email || "admin");
  }
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
