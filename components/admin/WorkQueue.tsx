"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Sparkles, Trash2 } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { ContentChannel, WorkflowStatus } from "@/lib/content-ops/types";
import { faqAnswerHtml, faqQuestionHtml } from "@/lib/content-ops/editorial-style";

type WorkItem = {
  id: string;
  title: string;
  summary: string;
  format: string;
  status: WorkflowStatus;
  source_label: string | null;
  scheduled_at: string | null;
  review_note: string | null;
  metadata?: {
    generated?: { bodyHtml?: string; faq?: { question: string; answer: string }[]; tags?: string[] };
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
    };
    redactionMode?: "standard" | "confidential";
    confidentialRegions?: unknown[];
  };
  content_review_assets?: { id: string; asset_type: "thumbnail" | "body_image" | "article_preview"; public_url: string; sort_order?: number; review_note?: string }[];
};

export default function WorkQueue({ channel, reviewMode = false }: { channel?: ContentChannel; reviewMode?: boolean }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [rebuildingImagesId, setRebuildingImagesId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
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
      const next = reviewMode
        ? activeItems.filter((item: WorkItem) => item.status === "review_required")
        : activeItems;
      setItems(next);
      setNotes(Object.fromEntries(next.map((item: WorkItem) => [item.id, item.review_note || ""])));
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
    patch: { action?: "regenerate" | "replace_topic" | "release_to_partner"; status?: WorkflowStatus; review_note?: string },
  ) {
    const regenerating = patch.action === "regenerate"
      || patch.action === "replace_topic"
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

  async function remove(item: WorkItem) {
    if (!window.confirm(`"${item.title}" 작업을 삭제할까요?\n연결된 자동화 작업과 검토 이미지도 함께 정리됩니다.`)) return;
    const response = await fetch(`/api/admin/content/${item.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || "작업을 삭제하지 못했습니다.");
      return;
    }
    await load();
  }

  async function rebuild(item: WorkItem) {
    setRebuildingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild_portfolio" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "목업과 본문을 다시 만들지 못했습니다.");
        return;
      }
      await load();
    } finally {
      setRebuildingId(null);
    }
  }

  async function rebuildImages(item: WorkItem, redactionMode?: "confidential") {
    setRebuildingImagesId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rebuild_portfolio_mockups",
          ...(redactionMode ? { redaction_mode: redactionMode } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "목업 이미지를 다시 만들지 못했습니다.");
        return;
      }
      await load();
    } finally {
      setRebuildingImagesId(null);
    }
  }

  async function rewritePendingStyle() {
    if (!channel || reviewMode) return;
    const label = channel === "naver_design" ? "디자인 블로그" : "컨설팅 블로그";
    if (!window.confirm(
      `${label}의 외주 포스팅 대기 원고를 친근한 말투·핵심어 볼드·Q./A. 형식으로 다듬을까요?\n이미 발행한 글과 포트폴리오 이미지는 변경하지 않습니다.`,
    )) return;
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
            <p className="font-bold text-orange-950">외주 대기 원고 말투 정리</p>
            <p className="mt-1 text-sm leading-6 text-orange-900/80">친근한 채널별 말투, 핵심어 볼드, FAQ의 Q.·A. 표기를 적용합니다.</p>
            {styleResult && <p className="mt-2 text-sm font-bold text-emerald-700">{styleResult}</p>}
          </div>
          <button
            type="button"
            onClick={() => void rewritePendingStyle()}
            disabled={rewritingStyle}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
          >
            <Sparkles size={16} className={rewritingStyle ? "animate-spin" : ""} />
            {rewritingStyle ? "원고 다듬는 중…" : "포스팅 대기 원고 다듬기"}
          </button>
        </section>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">
          {error}
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
                {item.scheduled_at ? ` · ${new Date(item.scheduled_at).toLocaleString("ko-KR")}` : ""}
              </p>
            </div>
            <StatusBadge status={item.status} />
          </div>
          {item.metadata?.portfolioReview && (
            <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                <span>실제 페이지 판정</span>
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
          {item.status === "approved"
            && item.format !== "portfolio"
            && (
              item.metadata?.novelty?.duplicate !== false
              || !Array.isArray(item.metadata?.validation?.issues)
              || item.metadata.validation.issues.length > 0
            ) && !item.metadata?.partnerReleaseOverride?.approvedAt && (
            <section className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <p className="font-bold">외주 전달 보류</p>
              <p className="mt-1">
                새 중복·구조 검사를 통과한 기록이 없는 과거 승인 원고입니다.
                다른 주제로 교체하거나, 현재 원고를 그대로 외주 작업실에 전달할 수 있습니다.
              </p>
              <button
                onClick={() => void update(item.id, { action: "release_to_partner" })}
                className="mt-3 rounded-xl bg-amber-950 px-4 py-2 text-xs font-bold text-white hover:bg-amber-900"
              >
                이 원고 그대로 승인·외주 전달
              </button>
            </section>
          )}
          {item.status === "on_hold" && (item.review_note || item.metadata?.validation?.issues?.length) ? (
            <section className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
              <p className="font-bold">보류 사유</p>
              {item.review_note && <p className="mt-1">{item.review_note}</p>}
              {item.metadata?.validation?.issues?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {item.metadata.validation.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}
            </section>
          ) : null}
          {item.content_review_assets?.some((asset) =>
            reviewMode || asset.asset_type === "thumbnail") ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...item.content_review_assets]
                .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
                .filter((asset) => reviewMode || asset.asset_type === "thumbnail")
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
              {item.metadata.generated.faq?.length ? <section className="mt-7 border-t border-[var(--line)] pt-5"><h3 className="text-lg font-bold">FAQ</h3>{item.metadata.generated.faq.map((faq) => <div key={faq.question} className="mt-4"><p className="font-bold" dangerouslySetInnerHTML={{ __html: faqQuestionHtml(faq.question) }} /><p className="mt-1 text-sm leading-6 text-[var(--muted)]" dangerouslySetInnerHTML={{ __html: faqAnswerHtml(faq.answer) }} /></div>)}</section> : null}
            </details>
          )}
          {reviewMode && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
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
          {!reviewMode && item.status !== "published" && (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
              {item.format === "portfolio" && (
                <>
                  <button
                    onClick={() => void rebuildImages(item, "confidential")}
                    disabled={rebuildingImagesId === item.id || rebuildingId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={rebuildingImagesId === item.id ? "animate-spin" : ""} />
                    {rebuildingImagesId === item.id
                      ? "기밀 영역 판정·목업 제작 중"
                      : item.metadata?.redactionMode === "confidential"
                        ? `기밀 블러 다시 적용 (${item.metadata.confidentialRegions?.length || 0}곳)`
                        : "기밀 블러 적용 후 목업 만들기"}
                  </button>
                  <button
                    onClick={() => void rebuildImages(item)}
                    disabled={rebuildingImagesId === item.id || rebuildingId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900 hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={rebuildingImagesId === item.id ? "animate-spin" : ""} />
                    {rebuildingImagesId === item.id ? "목업 이미지 다시 만드는 중" : "목업 이미지만 다시 만들기"}
                  </button>
                  <button
                    onClick={() => void rebuild(item)}
                    disabled={rebuildingId === item.id || rebuildingImagesId === item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <RotateCcw size={15} className={rebuildingId === item.id ? "animate-spin" : ""} />
                    {rebuildingId === item.id ? "목업·본문 다시 만드는 중" : "목업·본문 다시 만들기"}
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
