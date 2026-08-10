"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Sparkles, Trash2, Upload } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { ContentChannel, WorkflowStatus } from "@/lib/content-ops/types";
import { faqAnswerHtml, faqQuestionHtml } from "@/lib/content-ops/editorial-style";
import { formatSentenceLineBreaks } from "@/lib/content-ops/sentence-line-breaks";
import {
  PRIVATE_PORTFOLIO_SOURCE_NOTE,
  sourceSectionHtml,
} from "@/lib/content-ops/source-section";
import { HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE } from "@/lib/portfolio/hyundai-manual-mockups";

type PortfolioMockupMode = "short_psd" | "six_grid";
type PortfolioAspectClass = "16:9" | "4:3" | "a4_landscape" | "a4_portrait" | "mixed" | "unknown";
type PortfolioRedactionStatus = "verified" | "blocked";

type PortfolioMockupMetadata = {
  mode?: PortfolioMockupMode;
  bodyBoardCount?: number;
  aspectClass?: PortfolioAspectClass;
  selectedSlideIndexes?: number[];
  selectionReasons?: string[];
  redactionRegionCount?: number;
  redactionCoverage?: number;
  redactionStatus?: PortfolioRedactionStatus;
  manualSelectiveRedaction?: boolean;
};

type LegacyPortfolioAsset = {
  kind?: "thumbnail" | "body_image";
  slideIndexes?: number[];
  slideAspectRatio?: number;
};

type PortfolioJob = {
  id: string;
  job_type: "mockup" | "draft";
  status: string;
  next_retry_at: string | null;
  last_error_code: string | null;
  updated_at: string;
};

type WorkItem = {
  id: string;
  /** 어느 채널의 작업인지. 발행 완료 등록 화면을 네이버 채널에만 보여 주는 데 씁니다. */
  channel: string;
  title: string;
  summary: string;
  format: string;
  status: WorkflowStatus;
  source_label: string | null;
  scheduled_at: string | null;
  review_note: string | null;
  metadata?: {
    candidateId?: string;
    /** 관리자가 고르거나 직접 쓴 표지 문구 */
    coverTitle?: { title?: string; source?: string; savedAt?: string };
    /** 관리자가 직접 올린 이미지를 쓰는 중이라는 표시 */
    manualMockupOverride?: { kind?: string; approvedAt?: string; approvedBy?: string };
    generated?: {
      bodyHtml?: string;
      faq?: {
        question: string;
        answer: string;
        displayQuestionHtml?: string;
        displayAnswerHtml?: string;
      }[];
      tags?: string[];
      sourceUrls?: string[];
    };
    portfolioReview?: {
      suitable?: boolean;
      confidence?: number;
      documentType?: string;
      industry?: string;
      reasons?: string[];
      rejectionReasons?: string[];
      sensitiveRegions?: unknown[];
    };
    validation?: { plainLength?: number; h2Count?: number; faqCount?: number; figureCount?: number; issues?: string[] };
    novelty?: {
      duplicate?: boolean;
      blockedReason?: "missing_knowledge" | "duplicate";
      riskScore?: number;
      threshold?: number;
      rationale?: string;
      lookbackDays?: number;
      matches?: { id: string; title: string; format: string; score: number; reasons: string[] }[];
      attempts?: { title: string; riskScore: number; duplicate: boolean; issues: string[] }[];
      plan?: {
        topicFamily?: string;
        primaryTopic?: string;
        angle?: string;
        audience?: string;
        keyEntities?: string[];
      };
    };
    pendingRevision?: {
      note?: string;
      requestedAt?: string;
    };
    lastRevision?: {
      note?: string;
      appliedAt?: string;
    };
    partnerReleaseOverride?: {
      approvedAt?: string;
      approvedBy?: string;
      /** 관리자가 어떤 사유를 넘기고 보냈는지 기록 */
      overriddenReasons?: string[];
    };
    publicationValidation?: {
      duplicateLegacyUrl?: boolean;
      duplicateOf?: string;
    };
    portfolioMockup?: PortfolioMockupMetadata;
    portfolioAssets?: LegacyPortfolioAsset[];
    redactionMode?: "standard" | "confidential";
    confidentialRegions?: unknown[];
    portfolioStage?: "design_completed" | "draft_retry_wait" | "draft_completed" | "draft_failed";
  };
  content_review_assets?: { id: string; asset_type: "thumbnail" | "body_image" | "article_preview"; public_url: string; sort_order?: number; review_note?: string }[];
  portfolio_jobs?: PortfolioJob[];
  cover_title_suggestions?: string[];
  /** 외주 작업실 노출 여부와 막힌 사유. 서버가 외주 화면과 같은 함수로 계산합니다. */
  partner_visibility?: {
    blockers: { code: string; message: string }[];
  };
};

const mockupModeLabels: Record<PortfolioMockupMode, string> = {
  short_psd: "짧은 문서 · PSD 목업",
  six_grid: "긴 문서 · 6장 구성",
};

const aspectClassLabels: Record<PortfolioAspectClass, string> = {
  "16:9": "16:9",
  "4:3": "4:3",
  a4_landscape: "A4 가로",
  a4_portrait: "A4 세로",
  mixed: "혼합 규격",
  unknown: "규격 확인 필요",
};

function isMockupMode(value: unknown): value is PortfolioMockupMode {
  return value === "short_psd" || value === "six_grid";
}

function isAspectClass(value: unknown): value is PortfolioAspectClass {
  return value === "16:9"
    || value === "4:3"
    || value === "a4_landscape"
    || value === "a4_portrait"
    || value === "mixed"
    || value === "unknown";
}

function isRedactionStatus(value: unknown): value is PortfolioRedactionStatus {
  return value === "verified" || value === "blocked";
}

function PortfolioRetryStatus({ jobs }: { jobs?: PortfolioJob[] }) {
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    const update = () => setCurrentTime(Date.now());
    const initialTimer = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  const retryJobs = (jobs || []).filter((job) => (
    job.status !== "completed"
    && typeof job.next_retry_at === "string"
    && Number.isFinite(Date.parse(job.next_retry_at))
  ));
  if (!retryJobs.length) return null;

  return (
    <section className="mt-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      {retryJobs.map((job) => {
        const retryAt = Date.parse(job.next_retry_at || "");
        const stage = job.job_type === "mockup"
          ? "기밀 검수·우수 장표 선정·목업 생성"
          : "본문 초안 생성";
        const schedule = currentTime > 0 && retryAt <= currentTime
          ? "재시도 실행 대기"
          : new Date(retryAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
        return (
          <p key={job.id}>
            <strong>AI 자동 재시도 예정</strong>
            {` · ${stage} · ${schedule}`}
            {job.last_error_code ? ` · ${job.last_error_code}` : ""}
          </p>
        );
      })}
    </section>
  );
}

function safeSlideIndexes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((index): index is number => (
    typeof index === "number" && Number.isInteger(index) && index >= 0
  )))];
}

function safeReasons(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function classifyAspectRatio(ratio: number): Exclude<PortfolioAspectClass, "mixed"> {
  if (Math.abs(ratio - 16 / 9) <= 0.08) return "16:9";
  if (Math.abs(ratio - 4 / 3) <= 0.06) return "4:3";
  if (Math.abs(ratio - Math.SQRT2) <= 0.06) return "a4_landscape";
  if (Math.abs(ratio - 1 / Math.SQRT2) <= 0.05) return "a4_portrait";
  return "unknown";
}

function legacyAspectClass(assets: LegacyPortfolioAsset[]): PortfolioAspectClass | undefined {
  const aspectClasses = new Set(assets
    .map((asset) => asset.slideAspectRatio)
    .filter((ratio): ratio is number => typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0)
    .map(classifyAspectRatio));
  if (!aspectClasses.size) return undefined;
  if (aspectClasses.size > 1) return "mixed";
  return [...aspectClasses][0];
}

function legacyMockupMode(assets: LegacyPortfolioAsset[]): PortfolioMockupMode | undefined {
  const bodyAssets = assets.filter((asset) => asset.kind === "body_image");
  if (bodyAssets.length >= 5 || bodyAssets.some((asset) => safeSlideIndexes(asset.slideIndexes).length >= 6)) {
    return "six_grid";
  }
  if (bodyAssets.length === 4) return "short_psd";
  return undefined;
}

function PortfolioMockupDetails({ metadata }: { metadata?: WorkItem["metadata"] }) {
  if (!metadata) return null;

  const mockup = metadata.portfolioMockup;
  const legacyAssets = Array.isArray(metadata.portfolioAssets) ? metadata.portfolioAssets : [];
  const legacySlideIndexes = safeSlideIndexes(legacyAssets.flatMap((asset) => safeSlideIndexes(asset.slideIndexes)));
  const selectedSlideIndexes = safeSlideIndexes(mockup?.selectedSlideIndexes);
  const selectedSlideCount = selectedSlideIndexes.length || legacySlideIndexes.length;
  const bodyBoardCount = typeof mockup?.bodyBoardCount === "number"
    && Number.isInteger(mockup.bodyBoardCount)
    && mockup.bodyBoardCount >= 1
    && mockup.bodyBoardCount <= 5
    ? mockup.bodyBoardCount
    : legacyAssets.filter((asset) => asset.kind === "body_image").length || undefined;
  const selectionReasons = safeReasons(mockup?.selectionReasons);
  const mode = isMockupMode(mockup?.mode) ? mockup.mode : legacyMockupMode(legacyAssets);
  const aspectClass = isAspectClass(mockup?.aspectClass)
    ? mockup.aspectClass
    : legacyAspectClass(legacyAssets);
  const manualSelectiveRedaction = mockup?.manualSelectiveRedaction === true;
  const canonicalRegionCount = !manualSelectiveRedaction && typeof mockup?.redactionRegionCount === "number"
    && Number.isFinite(mockup.redactionRegionCount)
    && mockup.redactionRegionCount >= 0
    ? Math.floor(mockup.redactionRegionCount)
    : undefined;
  const legacyRegionCount = !manualSelectiveRedaction && Array.isArray(metadata.confidentialRegions)
    ? metadata.confidentialRegions.length
    : undefined;
  const redactionRegionCount = canonicalRegionCount ?? legacyRegionCount;
  const redactionCoverage = !manualSelectiveRedaction
    && typeof mockup?.redactionCoverage === "number"
    && Number.isFinite(mockup.redactionCoverage)
    ? Math.min(1, Math.max(0, mockup.redactionCoverage))
    : undefined;
  const redactionStatus = isRedactionStatus(mockup?.redactionStatus) ? mockup.redactionStatus : undefined;
  const hasLegacyRedaction = !redactionStatus && metadata.redactionMode === "confidential";
  const hasDetails = Boolean(
    mode
    || aspectClass
    || selectedSlideCount
    || bodyBoardCount
    || selectionReasons.length
    || redactionRegionCount !== undefined
    || redactionCoverage !== undefined
    || redactionStatus
    || manualSelectiveRedaction
    || hasLegacyRedaction,
  );

  if (!hasDetails) return null;

  return (
    <section className="mt-5 rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-sky-950">포트폴리오 목업</span>
        {mode && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900">
            {mockupModeLabels[mode]}
          </span>
        )}
        {aspectClass && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900">
            규격 {aspectClassLabels[aspectClass]}
          </span>
        )}
        {selectedSlideCount > 0 && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900">
            선정 장표 {selectedSlideCount}장
          </span>
        )}
        {bodyBoardCount !== undefined && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900">
            본문 목업 {bodyBoardCount}장
          </span>
        )}
        {manualSelectiveRedaction && (
          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
            관리자 수동 선택 블러
          </span>
        )}
        {redactionRegionCount !== undefined && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900">
            가림 영역 {redactionRegionCount}곳
          </span>
        )}
        {redactionCoverage !== undefined && (
          <span
            className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-900"
            title="선정 장표에서 겹치는 가림 영역을 한 번만 계산한 평균 면적입니다."
          >
            실제 가림 면적 {Math.round(redactionCoverage * 100)}%
          </span>
        )}
        {redactionStatus === "verified" && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            기밀 검수 상태: 통과
          </span>
        )}
        {redactionStatus === "blocked" && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">
            기밀 검수 상태: 차단
          </span>
        )}
        {hasLegacyRedaction && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
            기밀 검수 상태: 재검수 필요
          </span>
        )}
      </div>
      {selectionReasons.length > 0 && (
        <details className="mt-3 text-[var(--muted)]">
          <summary className="cursor-pointer font-bold text-sky-950">장표 선정 이유 {selectionReasons.length}개</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {selectionReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

function isPortfolioConversionHold(item: WorkItem) {
  if (item.format !== "portfolio" || item.status !== "on_hold") return false;
  if (item.review_note?.includes("MISSING_FONTS:")) return false;
  const failureContext = `${item.summary || ""} ${item.review_note || ""}`.toLowerCase();
  return failureContext.includes("pc worker retry limit reached")
    || failureContext.includes("insufficient_usable_slides")
    || failureContext.includes("shape_geometry_inspection_failed");
}

export default function WorkQueue({ channel, reviewMode = false }: { channel?: ContentChannel; reviewMode?: boolean }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 눌렀을 때 무슨 일이 일어났는지 알려 주는 안내 문구입니다.
  const [notice, setNotice] = useState("");
  const [draftRewritingId, setDraftRewritingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, { title: string; bodyHtml: string }>>({});
  const [savingEditId, setSavingEditId] = useState("");
  const [coverDrafts, setCoverDrafts] = useState<Record<string, string>>({});
  const [savingCoverId, setSavingCoverId] = useState("");
  const [uploadingImagesId, setUploadingImagesId] = useState("");
  const [publishUrls, setPublishUrls] = useState<Record<string, string>>({});
  const [publishingId, setPublishingId] = useState("");
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [mockupRebuildingId, setMockupRebuildingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [sourceUploadingId, setSourceUploadingId] = useState<string | null>(null);
  const [sourceLinks, setSourceLinks] = useState<Record<string, string>>({});
  const [rewritingStyle, setRewritingStyle] = useState(false);
  const [styleResult, setStyleResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/content${channel ? `?channel=${channel}` : ""}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "작업 목록을 불러오지 못했습니다.");
    else {
      const activeItems = data.filter(
        (item: WorkItem) => !item.review_note?.startsWith("generation-cancelled:"),
      );
      const next: WorkItem[] = reviewMode
        // 목업 이미지까지 끝난 포트폴리오는 본문 대기 상태(on_hold)로 남습니다.
        // 이 항목을 빼면 이미지가 이미 만들어졌는데도 검토 화면에 아무것도 보이지 않습니다.
        ? activeItems.filter((item: WorkItem) => item.status === "review_required"
          || (item.status === "on_hold" && item.metadata?.portfolioStage === "design_completed"))
        : activeItems;
      const displayItems = next.map((item) => {
        const generated = item.metadata?.generated;
        if (!generated) return item;
        return {
          ...item,
          metadata: {
            ...item.metadata,
            generated: {
              ...generated,
              bodyHtml: generated.bodyHtml
                ? formatSentenceLineBreaks(generated.bodyHtml)
                : generated.bodyHtml,
              faq: generated.faq?.map((faq) => ({
                ...faq,
                displayQuestionHtml: formatSentenceLineBreaks(faqQuestionHtml(faq.question)),
                displayAnswerHtml: formatSentenceLineBreaks(faqAnswerHtml(faq.answer)),
              })),
            },
          },
        };
      });
      // 손이 필요한 것부터 위로 올립니다. 상태가 뒤섞여 보이지 않게 하려는 목적입니다.
      const statusOrder: Record<string, number> = {
        review_required: 0,
        on_hold: 1,
        creating: 2,
        researching: 3,
        topic_candidate: 4,
        approved: 5,
        naver_ready: 6,
        scheduled: 7,
        published: 8,
      };
      const sortedItems = [...displayItems].sort((left, right) => {
        const orderGap = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
        if (orderGap !== 0) return orderGap;
        // 같은 상태끼리는 예정일이 빠른 것부터
        return String(left.scheduled_at || "").localeCompare(String(right.scheduled_at || ""));
      });
      setItems(sortedItems);
      setNotes(Object.fromEntries(sortedItems.map((item) => [item.id, item.review_note || ""])));
      setError("");
    }
    setLoading(false);
  }, [channel, reviewMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function update(
    id: string,
    patch: { action?: "regenerate" | "replace_topic" | "release_to_partner" | "retry_missing_fonts" | "retry_portfolio_conversion" | "restore_portfolio_draft" | "reflow_portfolio_images" | "correct_hyundai_content" | "clear_hold" | "retry_portfolio_draft"; status?: WorkflowStatus; review_note?: string },
  ) {
    const regenerating = patch.action === "regenerate"
      || patch.action === "replace_topic"
      || patch.action === "retry_missing_fonts"
      || patch.action === "retry_portfolio_conversion"
      || patch.action === "restore_portfolio_draft"
      || patch.action === "reflow_portfolio_images"
      || patch.action === "correct_hyundai_content"
      || patch.status === "creating";
    if (regenerating) setRegeneratingId(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/content/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "저장하지 못했습니다.");
        return;
      }
      await load();
    } finally {
      if (regenerating) setRegeneratingId(null);
    }
  }

  async function replaceTopic(item: WorkItem) {
    if (!window.confirm(
      `"${item.title}" 초안을 최근 글과 겹치지 않는 완전히 다른 주제로 교체할까요?\n현재 초안은 새 초안으로 대체됩니다.`,
    )) return;
    await update(item.id, { action: "replace_topic" });
  }

  async function remove(item: WorkItem, confirmPublished = false) {
    if (!confirmPublished
      && !window.confirm(`"${item.title}" 작업을 삭제할까요?\n연결된 자동화 작업과 검토 이미지도 함께 정리됩니다.`)) return;
    const response = await fetch(
      `/api/admin/content/${item.id}${confirmPublished ? "?confirmPublished=1" : ""}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const data = await response.json();
      // 발행 완료 항목은 한 번 더 확인한 뒤에만 지웁니다.
      // 같은 글이 두 번 등록되어 외주 작업실에서 발행 주소를 저장하지 못하는 경우에 필요합니다.
      if (data.requiresConfirmation === "confirmPublished") {
        if (window.confirm(`"${item.title}" 은 발행 완료 상태입니다.\n중복 등록을 정리하려는 것이 맞다면 삭제합니다. 계속할까요?`)) {
          await remove(item, true);
        }
        return;
      }
      setError(data.error || "작업을 삭제하지 못했습니다.");
      return;
    }
    await load();
  }

  /**
   * 목업 이미지를 직접 올려 교체합니다.
   * 올린 이미지에는 수동 확정 표시가 붙어 '다시 만들기'로 덮이지 않습니다.
   */
  async function uploadMockupImages(item: WorkItem, form: HTMLFormElement) {
    setUploadingImagesId(item.id);
    try {
      const response = await fetch(`/api/admin/content/${item.id}/mockup-images`, {
        method: "POST",
        body: new FormData(form),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "이미지를 올리지 못했습니다.");
        return;
      }
      form.reset();
      await load();
    } finally {
      setUploadingImagesId("");
    }
  }

  /**
   * 발행 완료를 관리자가 직접 등록합니다.
   * 외주 작업실에서만 가능하던 절차라, 작가가 등록하지 못하면 승인 완료에 머물렀습니다.
   * 검증과 중복 확인은 외주 화면과 동일하게 거칩니다.
   */
  async function markPublished(item: WorkItem) {
    const url = (publishUrls[item.id] || "").trim();
    if (!url) {
      setError("발행한 네이버 블로그 글 주소를 입력해 주세요.");
      return;
    }
    setPublishingId(item.id);
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_published", publishedUrl: url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "발행 완료로 등록하지 못했습니다.");
        return;
      }
      setPublishUrls((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
    } finally {
      setPublishingId("");
    }
  }

  /** 표지 문구를 저장합니다. AI를 부르지 않습니다. */
  async function saveCoverTitle(item: WorkItem, title: string, fromSuggestion: boolean) {
    if (!title.trim()) return;
    setSavingCoverId(item.id);
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_cover_title",
          coverTitle: title.trim(),
          chosenFromSuggestion: fromSuggestion,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "표지 문구를 저장하지 못했습니다.");
        return;
      }
      setCoverDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
    } finally {
      setSavingCoverId("");
    }
  }

  /** 사람이 직접 고쳐 저장합니다. AI를 부르지 않으므로 요금이 들지 않고 바로 반영됩니다. */
  async function saveManualEdit(item: WorkItem) {
    const draft = manualDrafts[item.id];
    if (!draft) return;
    setSavingEditId(item.id);
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual_edit", title: draft.title, bodyHtml: draft.bodyHtml }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "수정 내용을 저장하지 못했습니다.");
        return;
      }
      setManualDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
    } finally {
      setSavingEditId("");
    }
  }

  async function rebuild(item: WorkItem) {
    setRebuildingId(item.id);
    setError("");
    try {
      const draftOnly = item.metadata?.portfolioStage === "draft_failed";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(`/api/admin/content/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: draftOnly ? "retry_portfolio_draft" : "rebuild_portfolio",
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || "목업과 본문을 다시 만들지 못했습니다.");
          return;
        }
        if (data.status !== "creating" || data.retryAt || data.alreadyRunning) break;
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
      await load();
    } finally {
      setRebuildingId(null);
    }
  }

  /**
   * 이미지는 그대로 두고 글만 다시 씁니다.
   *
   * 지금까지는 글만 고치고 싶어도 이미지까지 전부 다시 만드는 버튼밖에 없었습니다.
   * 이미 마음에 드는 이미지가 지워지고 시간도 훨씬 오래 걸렸습니다.
   */
  async function rewriteDraftOnly(item: WorkItem) {
    setDraftRewritingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_portfolio_draft" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "본문만 다시 쓰지 못했습니다.");
        return;
      }
      setNotice("이미지는 그대로 두고 본문만 다시 썼습니다. 내용을 확인해 주세요.");
      await load();
    } finally {
      setDraftRewritingId(null);
    }
  }

  async function rebuildMockupsOnly(item: WorkItem) {
    setMockupRebuildingId(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild_portfolio_mockups" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "본문은 유지하고 목업 이미지만 다시 만들지 못했습니다.");
        return;
      }
      // 눌러도 아무 일이 없는 것처럼 보이던 경우들을 문장으로 알려 줍니다.
      setNotice(
        data.conversionRequeued
          ? "원본 PPT를 다시 변환해야 해서 PC 워커에 작업을 넘겼습니다. 변환이 끝나면 이미지가 새로 만들어집니다."
          : data.conversionActive
            ? "원본 변환이 아직 진행 중입니다. 끝난 뒤에 다시 눌러 주세요."
            : data.alreadyRunning
              ? "이미 이미지를 다시 만드는 중입니다. 잠시 뒤 새로고침해 주세요."
              : "목업 이미지를 새 가림 규칙으로 다시 만들었습니다.",
      );
      await load();
    } finally {
      setMockupRebuildingId(null);
    }
  }

  async function connectPortfolioSource(item: WorkItem, file: File) {
    setSourceUploadingId(item.id);
    setError("");
    try {
      const fileBytes = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest("SHA-256", fileBytes);
      const fileHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const signatureHex = Array.from(new Uint8Array(fileBytes.slice(0, 8)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const fileDetails = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        fileHash,
        signatureHex,
      };
      const prepareResponse = await fetch(`/api/admin/content/${item.id}/portfolio-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", ...fileDetails }),
      });
      const prepared = await readJsonResponse(prepareResponse);
      if (!prepareResponse.ok) {
        setError(typeof prepared.error === "string" ? prepared.error : "원본 업로드를 준비하지 못했습니다.");
        return;
      }

      const authorization = String(prepared.uploadAuthorization || "");
      const apiKey = authorization.replace(/^Bearer\s+/i, "");
      const uploadUrl = String(prepared.uploadUrl || "");
      if (!uploadUrl || !authorization || !apiKey) {
        setError("원본 업로드 주소 또는 인증 정보를 받지 못했습니다.");
        return;
      }
      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "3600");
      uploadBody.append("", file);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: authorization,
          apikey: apiKey,
          "x-upsert": "false",
        },
        body: uploadBody,
      });
      if (!uploadResponse.ok) {
        const uploadFailure = await readJsonResponse(uploadResponse);
        const message = typeof uploadFailure.message === "string"
          ? uploadFailure.message
          : typeof uploadFailure.error === "string"
            ? uploadFailure.error
            : `HTTP ${uploadResponse.status}`;
        setError(`원본 파일 업로드에 실패했습니다. (${message})`);
        return;
      }

      const commitResponse = await fetch(`/api/admin/content/${item.id}/portfolio-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          uploadId: prepared.uploadId,
          ...fileDetails,
        }),
      });
      const committed = await readJsonResponse(commitResponse);
      if (!commitResponse.ok) {
        setError(typeof committed.error === "string" ? committed.error : "업로드한 원본을 작업물에 연결하지 못했습니다.");
        return;
      }
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error
        ? uploadError.message
        : "원본 연결 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSourceUploadingId(null);
    }
  }

  async function connectPortfolioSourceLink(item: WorkItem) {
    const shareUrl = sourceLinks[item.id]?.trim();
    if (!shareUrl) {
      setError("네이버웍스 공유 주소를 입력해주세요.");
      return;
    }
    setSourceUploadingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/content/${item.id}/portfolio-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect_link", shareUrl }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "공유 원본을 연결하지 못했습니다.");
        return;
      }
      setSourceLinks((current) => ({ ...current, [item.id]: "" }));
      await load();
    } finally {
      setSourceUploadingId(null);
    }
  }

  async function rewritePendingStyle() {
    if (!channel || reviewMode) return;
    setRewritingStyle(true);
    setStyleResult("");
    setError("");
    try {
      const response = await fetch("/api/admin/content/rewrite-pending-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "외주 대기 원고의 말투를 다듬지 못했습니다.");
        return;
      }
      const failureDetails = (data.results || [])
        .filter((result: { success: boolean }) => !result.success)
        .map((result: { title: string; error: string }) => `${result.title}: ${result.error}`)
        .join(" / ");
      setStyleResult(
        `대기 원고 ${data.found}건 중 ${data.updated}건을 다듬었습니다.${data.failed ? ` 실패 ${data.failed}건은 원문을 유지했습니다.${failureDetails ? ` 사유: ${failureDetails}` : ""}` : ""}`,
      );
      await load();
    } finally {
      setRewritingStyle(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-[var(--muted)]">작업 목록을 불러오고 있습니다.</p>;
  if (!items.length) return <p className="mt-6 rounded-xl border border-dashed border-[var(--line)] bg-white p-7 text-center text-sm text-[var(--muted)]">현재 대기 중인 작업이 없습니다.</p>;

  return (
    <div className="mt-6 space-y-4">
      {channel && !reviewMode && (
        <section className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-orange-950">검토 요청·포스팅 대기 원고 규칙 정리</p>
            <p className="mt-1 text-sm leading-6 text-orange-900/80">
              100자 이하의 짧은 문장, 간결한 FAQ, 자연스러운 말투와 핵심어 강조를 적용합니다. 검토 요청 글도 함께 정리하며 수치·링크·이미지는 보존합니다.
            </p>
            {styleResult && <p className="mt-2 text-sm font-bold text-emerald-700">{styleResult}</p>}
          </div>
          <button
            type="button"
            onClick={() => void rewritePendingStyle()}
            disabled={rewritingStyle}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
          >
            <Sparkles size={16} className={rewritingStyle ? "animate-spin" : ""} />
            {rewritingStyle ? "원고 규칙 확인 중…" : "검토·대기 원고 정리"}
          </button>
        </section>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900" role="status">
          {notice}
        </p>
      )}
      {items.map((item) => (
        <article key={item.id} className="card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold text-[var(--primary)]">{item.format}</p>
              <h3 className="mt-1 text-lg font-bold">{item.title}</h3>
              {item.summary && <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.summary}</p>}
              <p className="mt-2 text-xs text-[var(--muted)]">
                {item.source_label || "자동 일정"}
                {item.scheduled_at ? ` · ${new Date(item.scheduled_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}
              </p>
            </div>
            <StatusBadge status={item.status} />
          </div>
          {item.format === "portfolio" && <PortfolioRetryStatus jobs={item.portfolio_jobs} />}
          {item.format === "portfolio"
            && ["design_completed", "draft_retry_wait"].includes(String(item.metadata?.portfolioStage || "")) && (
            <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
              <p className="font-bold">디자인 목업 완료</p>
              <p>로컬 템플릿과 기밀 블러로 만든 이미지는 아래에서 바로 확인할 수 있습니다. Gemini는 본문 글쓰기만 별도로 처리합니다.</p>
            </section>
          )}
          {item.metadata?.portfolioReview && (
            <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                <span>로컬 장표 분석</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs">
                  신뢰도 {Math.round(Number(item.metadata.portfolioReview.confidence || 0) * 100)}%
                </span>
                {item.metadata.portfolioReview.documentType && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs">{item.metadata.portfolioReview.documentType}</span>
                )}
                {item.metadata.portfolioReview.industry && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs">{item.metadata.portfolioReview.industry}</span>
                )}
              </div>
              {(item.metadata.portfolioReview.reasons || []).length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[var(--muted)]">
                  {item.metadata.portfolioReview.reasons?.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <p className="mt-3 text-xs text-[var(--muted)]">
                자동 가림 후보 {item.metadata.portfolioReview.sensitiveRegions?.length || 0}곳
                {item.metadata.validation?.plainLength ? ` · 본문 ${item.metadata.validation.plainLength.toLocaleString()}자` : ""}
                {item.metadata.validation?.figureCount ? ` · 완성 이미지 ${item.metadata.validation.figureCount + 1}장` : ""}
              </p>
            </section>
          )}
          <PortfolioMockupDetails metadata={item.metadata} />
          {item.metadata?.novelty && item.format !== "portfolio" && (
            <section className={`mt-5 rounded-xl border p-4 text-sm ${
              item.metadata.novelty.duplicate
                ? "border-red-200 bg-red-50 text-red-900"
                : item.metadata.novelty.blockedReason === "missing_knowledge"
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50/70 text-emerald-950"
            }`}>
              <div className="flex flex-wrap items-center gap-2 font-bold">
                <span>최근 {item.metadata.novelty.lookbackDays || 90}일 중복 검사</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs">
                  중복 위험 {item.metadata.novelty.riskScore || 0}점
                </span>
                <span className="rounded-full bg-white px-3 py-1 text-xs">
                  {item.metadata.novelty.duplicate
                    ? "자동 차단"
                    : item.metadata.novelty.blockedReason === "missing_knowledge"
                      ? "원천자료 확인 필요"
                      : "통과"}
                </span>
              </div>
              {item.metadata.novelty.plan && (
                <p className="mt-3 leading-6">
                  <strong>{item.metadata.novelty.plan.topicFamily || "선정 주제"}</strong>
                  {item.metadata.lastRevision
                    ? " · 사용자의 최신 수정 요청에 따라 기존 글 보완"
                    : item.metadata.novelty.plan.angle
                      ? ` · ${item.metadata.novelty.plan.angle}`
                      : ""}
                </p>
              )}
              {item.metadata.novelty.rationale && (
                <p className="mt-1 leading-6 opacity-80">차별점: {item.metadata.novelty.rationale}</p>
              )}
              {item.metadata.novelty.matches?.length ? (
                <div className="mt-3">
                  <p className="font-bold">가장 유사한 기존 글</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 opacity-80">
                    {item.metadata.novelty.matches.map((match) => (
                      <li key={match.id}>
                        {match.title} · {match.score}점
                        {match.reasons.length ? ` · ${match.reasons.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}
          {item.metadata?.pendingRevision?.note && (
            <section className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
              <p className="font-bold">보존된 수정 요청</p>
              <p className="mt-1 whitespace-pre-wrap">{item.metadata.pendingRevision.note}</p>
              <p className="mt-2 text-xs opacity-70">
                생성에 실패해도 이 요청은 사라지지 않으며, 아래 재시도 버튼이 같은 요청을 다시 반영합니다.
              </p>
            </section>
          )}
          {item.metadata?.publicationValidation?.duplicateLegacyUrl && (
            <section className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">
              <p className="font-bold">기존 발행 URL 중복 확인 필요</p>
              <p className="mt-1">
                이 작업의 발행 주소가 다른 과거 작업과 중복되어 링크를 외주 화면에서 숨겼습니다.
                실제 네이버 글을 확인한 뒤 올바른 작업과 URL을 정정해 주세요.
              </p>
            </section>
          )}
          {/*
            승인했는데 외주 작업실에 안 보이는 상태를 눈에 보이게 만듭니다.
            여기 뜨는 사유는 외주 화면이 쓰는 판단 결과 그대로입니다.
          */}
          {["approved", "naver_ready", "scheduled"].includes(item.status)
            && item.partner_visibility
            && item.partner_visibility.blockers.length > 0 && (
            <section className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">
              <p className="font-bold">외주 작업실에 아직 보이지 않습니다</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {item.partner_visibility.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${index}`}>{blocker.message}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs opacity-80">
                사유를 정리해 다시 만들거나, 지금 상태 그대로 최작가님께 넘길 수 있습니다.
              </p>
              <button
                onClick={() => void update(item.id, { action: "release_to_partner" })}
                className="mt-3 rounded-xl bg-amber-950 px-4 py-2 text-xs font-bold text-white hover:bg-amber-900"
              >
                이 상태 그대로 외주 작업실에 전달
              </button>
            </section>
          )}
          {item.metadata?.partnerReleaseOverride?.approvedAt
            && item.status !== "published" && (
            <section className="mt-5 rounded-xl border border-[var(--line)] bg-white p-4 text-xs leading-6 text-[var(--muted)]">
              <p>
                관리자가 규칙 검사를 넘기고 외주 작업실에 전달한 작업입니다.
                {item.metadata.partnerReleaseOverride.approvedBy
                  ? ` (${item.metadata.partnerReleaseOverride.approvedBy})`
                  : ""}
              </p>
              {item.metadata.partnerReleaseOverride.overriddenReasons?.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {item.metadata.partnerReleaseOverride.overriddenReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}
          {/*
            보류 상태에서는 사유가 없어도 상자를 띄웁니다.
            사유가 비어 있으면 "왜 보류인지 모르겠다"는 상태가 되어 손을 못 댑니다.
          */}
          {item.status === "on_hold" ? (
            <section className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
              <p className="font-bold">보류 사유</p>
              {item.review_note && <p className="mt-1">{item.review_note}</p>}
              {item.metadata?.validation?.issues?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {item.metadata.validation.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}
              {!item.review_note && !item.metadata?.validation?.issues?.length ? (
                <p className="mt-1">
                  기록된 사유가 없습니다. 예전에 걸렸던 보류가 그대로 남아 있는 경우입니다.
                </p>
              ) : null}
              <p className="mt-2 text-xs opacity-80">
                목업 이미지를 다시 만들어도 보류는 자동으로 풀리지 않습니다.
                내용을 확인하셨다면 아래에서 직접 해제해 주세요. AI를 부르지 않습니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void update(item.id, { action: "clear_hold" })}
                  className="rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100"
                >
                  보류 해제 · 검토요청으로
                </button>
                <button
                  onClick={() => void update(item.id, { status: "approved" })}
                  className="rounded-xl bg-red-800 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
                >
                  확인했습니다 · 바로 승인
                </button>
              </div>
            </section>
          ) : null}
          {item.content_review_assets?.some((asset) =>
            reviewMode || Boolean(item.metadata?.portfolioStage) || asset.asset_type === "thumbnail") ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...item.content_review_assets]
                .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
                .filter((asset) => reviewMode || Boolean(item.metadata?.portfolioStage) || asset.asset_type === "thumbnail")
                .map((asset, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={asset.id}
                  src={asset.public_url}
                  alt={`${item.title} 검토 이미지 ${index + 1}`}
                  className="w-full rounded-xl border border-[var(--line)]"
                />
              ))}
            </div>
          ) : null}
          {item.metadata?.generated?.bodyHtml && (
            <details className="mt-5 rounded-xl border border-[var(--line)] bg-white p-5">
              <summary className="cursor-pointer font-bold">이미지가 배치된 글 전체 미리보기</summary>
              <div className="column-body mt-5" dangerouslySetInnerHTML={{ __html: item.metadata.generated.bodyHtml }} />
              {item.metadata.generated.faq?.length ? <section className="mt-7 border-t border-[var(--line)] pt-5"><h3 className="text-lg font-bold">FAQ</h3>{item.metadata.generated.faq.map((faq) => <div key={faq.question} className="mt-4"><p className="font-bold" dangerouslySetInnerHTML={{ __html: faq.displayQuestionHtml || faqQuestionHtml(faq.question) }} /><p className="mt-1 text-sm leading-6 text-[var(--muted)]" dangerouslySetInnerHTML={{ __html: faq.displayAnswerHtml || faqAnswerHtml(faq.answer) }} /></div>)}</section> : null}
              {(item.metadata.generated.sourceUrls?.length || item.format === "portfolio") ? (
                <div
                  className="column-body mt-7 border-t border-[var(--line)] pt-5"
                  dangerouslySetInnerHTML={{
                    __html: sourceSectionHtml(item.metadata.generated.sourceUrls, {
                      note: item.format === "portfolio" ? PRIVATE_PORTFOLIO_SOURCE_NOTE : null,
                    }),
                  }}
                />
              ) : null}
            </details>
          )}
          {/* 작가가 등록하지 못한 경우를 대비해 관리자도 발행 완료를 등록할 수 있게 합니다. */}
          {!reviewMode
            && (item.channel === "naver_consulting" || item.channel === "naver_design")
            && (item.status === "approved" || item.status === "naver_ready" || item.status === "scheduled") && (
            <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
              <p className="text-sm font-bold text-teal-950">발행 완료 등록</p>
              <p className="mt-1 text-xs text-teal-900">
                네이버에 이미 올린 글이라면 그 주소를 넣어 발행 완료로 옮깁니다. 외주 작업실에서 등록하지 못했을 때 쓰세요.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className="input flex-1"
                  placeholder="https://blog.naver.com/계정/게시글번호"
                  value={publishUrls[item.id] ?? ""}
                  onChange={(event) => setPublishUrls((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <button
                  onClick={() => void markPublished(item)}
                  disabled={publishingId === item.id || !(publishUrls[item.id] || "").trim()}
                  className="rounded-xl border border-teal-300 bg-white px-4 py-2 text-sm font-bold text-teal-950 disabled:opacity-50"
                >
                  {publishingId === item.id ? "등록 중…" : "발행 완료로 등록"}
                </button>
              </div>
            </div>
          )}
          {/* 만들어진 이미지가 마음에 들지 않으면 직접 만든 이미지로 바꿉니다. */}
          {item.format === "portfolio" && item.status !== "published" && (
            <form
              className="mt-5 rounded-xl border border-violet-200 bg-violet-50/60 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void uploadMockupImages(item, event.currentTarget);
              }}
            >
              <p className="text-sm font-bold text-violet-950">이미지 직접 올리기</p>
              <p className="mt-1 text-xs text-violet-900">
                직접 만드신 이미지로 바꿉니다. 올린 이미지는 &lsquo;다시 만들기&rsquo;를 눌러도 확인 없이 지워지지 않습니다.
                PNG · JPG · WEBP, 한 장에 12MB까지.
              </p>
              {item.metadata?.manualMockupOverride ? (
                <p className="mt-2 rounded-lg bg-violet-100 px-3 py-2 text-xs font-bold text-violet-950">
                  지금 이 작업은 직접 올린 이미지를 쓰고 있습니다.
                </p>
              ) : null}
              <label className="mt-3 block text-xs font-bold text-violet-950">대표 썸네일 (1장)</label>
              <input type="file" name="thumbnail" accept="image/png,image/jpeg,image/webp" className="mt-1 block w-full text-sm" />
              <label className="mt-3 block text-xs font-bold text-violet-950">본문 이미지 (여러 장 선택 가능)</label>
              <input type="file" name="bodyImages" accept="image/png,image/jpeg,image/webp" multiple className="mt-1 block w-full text-sm" />
              <button
                type="submit"
                disabled={uploadingImagesId === item.id}
                className="mt-3 rounded-xl border border-violet-300 bg-white px-4 py-2 text-sm font-bold text-violet-950 disabled:cursor-wait disabled:opacity-60"
              >
                {uploadingImagesId === item.id ? "올리는 중…" : "이 이미지로 교체"}
              </button>
            </form>
          )}
          {/* 표지 문구는 사람이 고르거나 직접 씁니다. 고른 문구는 다음 추천에 반영됩니다. */}
          {item.format === "portfolio" && item.status !== "published" && (
            <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
              <p className="text-sm font-bold text-sky-950">표지 문구</p>
              <p className="mt-1 text-xs text-sky-900">
                지금 문구: <b>{item.metadata?.coverTitle?.title || "아직 정하지 않음 (자동 생성)"}</b>
              </p>
              {item.cover_title_suggestions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.cover_title_suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => void saveCoverTitle(item, suggestion, true)}
                      disabled={savingCoverId === item.id}
                      className="rounded-full border border-sky-300 bg-white px-3.5 py-2 text-sm font-bold text-sky-950 disabled:cursor-wait disabled:opacity-60"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className="input flex-1"
                  placeholder="직접 쓰기 (2~40자)"
                  value={coverDrafts[item.id] ?? ""}
                  onChange={(event) => setCoverDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <button
                  onClick={() => void saveCoverTitle(item, coverDrafts[item.id] || "", false)}
                  disabled={savingCoverId === item.id || !(coverDrafts[item.id] || "").trim()}
                  className="rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-bold text-sky-950 disabled:opacity-50"
                >
                  {savingCoverId === item.id ? "저장 중…" : "이 문구로 저장"}
                </button>
              </div>
              <p className="mt-2 text-xs text-sky-900">
                저장한 뒤 아래 &lsquo;② 이미지만 다시 만들기&rsquo;를 누르면 표지에 반영됩니다.
              </p>
            </div>
          )}
          {reviewMode && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              {/* 사람이 직접 고쳐 저장합니다. AI를 부르지 않아 요금이 들지 않고 즉시 반영됩니다. */}
              {manualDrafts[item.id] ? (
                <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50/60 p-4">
                  <p className="text-sm font-bold text-emerald-950">직접 수정</p>
                  <p className="mt-1 text-xs text-emerald-900">
                    고치고 저장하면 바로 반영됩니다. AI를 부르지 않아 요금이 들지 않고 기다릴 필요도 없습니다.
                  </p>
                  <label className="mt-3 block text-xs font-bold text-emerald-950">제목</label>
                  <input
                    className="input mt-1"
                    value={manualDrafts[item.id].title}
                    onChange={(event) => setManualDrafts((current) => ({
                      ...current,
                      [item.id]: { ...current[item.id], title: event.target.value },
                    }))}
                  />
                  <label className="mt-3 block text-xs font-bold text-emerald-950">
                    본문 (h2, h3, p, ul, ol, li, strong, blockquote, a 태그를 쓸 수 있습니다)
                  </label>
                  <textarea
                    className="input mt-1 font-mono text-xs"
                    rows={16}
                    value={manualDrafts[item.id].bodyHtml}
                    onChange={(event) => setManualDrafts((current) => ({
                      ...current,
                      [item.id]: { ...current[item.id], bodyHtml: event.target.value },
                    }))}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void saveManualEdit(item)}
                      disabled={savingEditId === item.id}
                      className="btn-gradient rounded-xl px-4 py-2 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"
                    >
                      {savingEditId === item.id ? "저장 중…" : "수정 내용 저장"}
                    </button>
                    <button
                      onClick={() => setManualDrafts((current) => {
                        const next = { ...current };
                        delete next[item.id];
                        return next;
                      })}
                      className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setManualDrafts((current) => ({
                    ...current,
                    [item.id]: {
                      title: item.title || "",
                      bodyHtml: String(item.metadata?.generated?.bodyHtml || ""),
                    },
                  }))}
                  className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-950"
                >
                  직접 수정하기 (AI 호출 없음)
                </button>
              )}
              <textarea className="input" rows={3} value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="수정 요청이나 가려야 할 내용을 적어주세요." />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void update(item.id, { status: "creating", review_note: notes[item.id] || "" })}
                  disabled={regeneratingId === item.id}
                  className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60"
                >
                  {regeneratingId === item.id ? "수정 반영 중" : "수정 요청"}
                </button>
                {item.format !== "portfolio" && (
                  <button
                    onClick={() => void replaceTopic(item)}
                    disabled={regeneratingId === item.id}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-950 disabled:cursor-wait disabled:opacity-60"
                  >
                    {regeneratingId === item.id ? "새 주제 선정 중" : "다른 주제로 교체"}
                  </button>
                )}
                <button onClick={() => void update(item.id, { status: "approved", review_note: notes[item.id] || "" })} className="btn-gradient rounded-xl px-4 py-2 text-sm font-bold text-white">완성본 승인</button>
                <button onClick={() => void update(item.id, { status: "on_hold", review_note: notes[item.id] || "" })} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold">보류</button>
              </div>
            </div>
          )}
          {!reviewMode && (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
              {/* 다시 만들기 계열은 발행 전에만 의미가 있습니다. 삭제는 발행 완료 항목에도 필요합니다. */}
              {item.status !== "published" && item.format === "portfolio" && (
                <p className="w-full text-right text-xs text-[var(--muted)]">
                  ① 이미 있는 이미지의 자리만 정리 · ② 이미지를 새로 그림(블러 규칙도 여기서 다시 적용) · ③ 이미지와 글을 처음부터 (AI 요금 발생)
                </p>
              )}
              {item.status !== "published" && item.format === "portfolio" && (
                <>
                  {!item.metadata?.candidateId && (
                    <>
                      <div className="flex min-w-[320px] flex-1 flex-wrap justify-end gap-2">
                        <input
                          type="url"
                          aria-label={`${item.title} 네이버웍스 공유 주소`}
                          className="min-w-[250px] flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs"
                          placeholder="https://works.do/..."
                          value={sourceLinks[item.id] || ""}
                          disabled={sourceUploadingId === item.id}
                          onChange={(event) => setSourceLinks((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))}
                        />
                        <button
                          type="button"
                          onClick={() => void connectPortfolioSourceLink(item)}
                          disabled={sourceUploadingId === item.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          <Upload size={15} />
                          {sourceUploadingId === item.id ? "공유 원본 연결 중…" : "공유 주소로 원본 연결"}
                        </button>
                      </div>
                      <label
                        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-100 has-[:disabled]:cursor-wait has-[:disabled]:opacity-60"
                        aria-disabled={sourceUploadingId === item.id}
                      >
                        <input
                          type="file"
                          accept=".ppt,.pptx,.pptm,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                          className="sr-only"
                          disabled={sourceUploadingId === item.id}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void connectPortfolioSource(item, file);
                          }}
                        />
                        <Upload size={15} />
                        {sourceUploadingId === item.id
                          ? "원본 연결·재생성 요청 중…"
                          : "원본 PPT 연결 후 재생성"}
                      </label>
                    </>
                  )}
                  {isPortfolioConversionHold(item) && (
                    <button
                      onClick={() => void update(item.id, { action: "retry_portfolio_conversion" })}
                      disabled={regeneratingId === item.id || rebuildingId === item.id || mockupRebuildingId === item.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-950 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                      {regeneratingId === item.id ? "원본 PPT 변환 다시 시도 중…" : "원본 PPT 변환 다시 시도"}
                    </button>
                  )}
                  {item.status === "on_hold" && item.review_note?.startsWith("MISSING_FONTS:") && (
                    <button
                      onClick={() => void update(item.id, { action: "retry_missing_fonts" })}
                      disabled={regeneratingId === item.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-950 disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                      {regeneratingId === item.id ? "글꼴 확인 후 재요청 중" : "글꼴 설치 후 다시 처리"}
                    </button>
                  )}
                  {!item.metadata?.generated?.bodyHtml && (
                    <button
                      onClick={() => void update(item.id, { action: "restore_portfolio_draft" })}
                      disabled={regeneratingId === item.id || rebuildingId === item.id || mockupRebuildingId === item.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                      {regeneratingId === item.id ? "기존 본문 복구 중…" : "기존 본문 복구"}
                    </button>
                  )}
                  {item.metadata?.generated?.bodyHtml && (
                    <button
                      onClick={() => void update(item.id, { action: "reflow_portfolio_images" })}
                      disabled={regeneratingId === item.id || rebuildingId === item.id || mockupRebuildingId === item.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                      {regeneratingId === item.id ? "배치 정리 중…" : "① 이미지 배치만 정리 · 새로 안 만듦"}
                    </button>
                  )}
                  {item.title === HYUNDAI_MANUAL_MOCKUP_LEGACY_TITLE && (
                    <button
                      onClick={() => void update(item.id, { action: "correct_hyundai_content" })}
                      disabled={regeneratingId === item.id || rebuildingId === item.id || mockupRebuildingId === item.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-950 hover:bg-orange-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Sparkles size={15} />
                      {regeneratingId === item.id
                        ? "생활폐기물 입찰 내용 정정 중…"
                        : "생활폐기물 입찰 내용으로 정정"}
                    </button>
                  )}
                  <button
                    onClick={() => void rebuildMockupsOnly(item)}
                    disabled={regeneratingId === item.id || rebuildingId === item.id || mockupRebuildingId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-950 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={mockupRebuildingId === item.id ? "animate-spin" : ""} />
                    {mockupRebuildingId === item.id
                      ? "이미지 다시 만드는 중…"
                      : "② 이미지만 다시 만들기 · 글은 그대로 (블러는 여기)"}
                  </button>
                  <button
                    onClick={() => void rewriteDraftOnly(item)}
                    disabled={regeneratingId === item.id || rebuildingId === item.id
                      || mockupRebuildingId === item.id || draftRewritingId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={draftRewritingId === item.id ? "animate-spin" : ""} />
                    {draftRewritingId === item.id
                      ? "글 다시 쓰는 중…"
                      : "③ 글만 다시 쓰기 · 이미지는 그대로 (AI 사용)"}
                  </button>
                  <button
                    onClick={() => void rebuild(item)}
                    disabled={regeneratingId === item.id || rebuildingId === item.id
                      || mockupRebuildingId === item.id || draftRewritingId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-950 hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={rebuildingId === item.id ? "animate-spin" : ""} />
                    {rebuildingId === item.id
                      ? item.metadata?.portfolioStage === "draft_failed"
                        ? "본문만 다시 생성 중…"
                        : "이미지와 글 전부 다시 만드는 중…"
                      : item.metadata?.portfolioStage === "draft_failed"
                        ? "본문만 다시 생성"
                        : "④ 이미지와 글 전부 다시 만들기 · AI 사용"}
                  </button>
                </>
              )}
              {item.format !== "portfolio"
                && (
                  item.status === "creating"
                  || item.status === "on_hold"
                  || Boolean(item.metadata?.pendingRevision?.note)
                ) && (
                <button
                  onClick={() => void update(item.id, { action: "regenerate" })}
                  disabled={regeneratingId === item.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 disabled:cursor-wait disabled:opacity-60"
                >
                  <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                  {regeneratingId === item.id
                    ? "초안 다시 만드는 중"
                    : item.metadata?.pendingRevision?.note
                      ? "보존된 수정 요청 다시 반영"
                      : "멈춘 초안 다시 만들기"}
                </button>
              )}
              {item.format !== "portfolio"
                && (item.status === "review_required" || item.status === "on_hold" || item.status === "approved") && (
                <button
                  onClick={() => void replaceTopic(item)}
                  disabled={regeneratingId === item.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
                >
                  <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                  {regeneratingId === item.id ? "새 주제 선정 중" : "중복 검사 후 다른 주제로 교체"}
                </button>
              )}
              <button
                onClick={() => void remove(item)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                <Trash2 size={15} /> 작업 삭제
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
