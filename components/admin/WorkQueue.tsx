"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { ContentChannel, WorkflowStatus } from "@/lib/content-ops/types";

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
  };
  content_review_assets?: { id: string; asset_type: "thumbnail" | "body_image" | "article_preview"; public_url: string; sort_order?: number; review_note?: string }[];
};

export default function WorkQueue({ channel, reviewMode = false }: { channel?: ContentChannel; reviewMode?: boolean }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

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
    patch: { action?: "regenerate"; status?: WorkflowStatus; review_note?: string },
  ) {
    const regenerating = patch.action === "regenerate" || patch.status === "creating";
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

  if (loading) return <p className="mt-6 text-sm text-[var(--muted)]">작업 목록을 불러오고 있습니다.</p>;
  if (error) return <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>;
  if (!items.length) return <p className="mt-6 rounded-xl border border-dashed border-[var(--line)] bg-white p-7 text-center text-sm text-[var(--muted)]">현재 대기 중인 작업이 없습니다.</p>;

  return (
    <div className="mt-6 space-y-4">
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
              {item.metadata.generated.faq?.length ? <section className="mt-7 border-t border-[var(--line)] pt-5"><h3 className="text-lg font-bold">FAQ</h3>{item.metadata.generated.faq.map((faq) => <div key={faq.question} className="mt-4"><p className="font-bold">{faq.question}</p><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{faq.answer}</p></div>)}</section> : null}
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
                <button onClick={() => void update(item.id, { status: "approved", review_note: notes[item.id] || "" })} className="btn-gradient rounded-xl px-4 py-2 text-sm font-bold text-white">완성본 승인</button>
                <button onClick={() => void update(item.id, { status: "on_hold", review_note: notes[item.id] || "" })} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold">보류</button>
              </div>
            </div>
          )}
          {!reviewMode && item.status !== "published" && (
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
              {item.format === "portfolio" && (
                <button
                  onClick={() => void rebuild(item)}
                  disabled={rebuildingId === item.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 disabled:cursor-wait disabled:opacity-60"
                >
                  <RotateCcw size={15} className={rebuildingId === item.id ? "animate-spin" : ""} />
                  {rebuildingId === item.id ? "목업·본문 다시 만드는 중" : "목업·본문 다시 만들기"}
                </button>
              )}
              {item.format !== "portfolio" && (item.status === "creating" || item.status === "on_hold") && (
                <button
                  onClick={() => void update(item.id, { action: "regenerate" })}
                  disabled={regeneratingId === item.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 disabled:cursor-wait disabled:opacity-60"
                >
                  <RotateCcw size={15} className={regeneratingId === item.id ? "animate-spin" : ""} />
                  {regeneratingId === item.id ? "초안 다시 만드는 중" : "멈춘 초안 다시 만들기"}
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
