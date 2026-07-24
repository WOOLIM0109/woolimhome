"use client";

import { useCallback, useEffect, useState } from "react";
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
  content_review_assets?: { id: string; public_url: string }[];
};

export default function WorkQueue({ channel, reviewMode = false }: { channel?: ContentChannel; reviewMode?: boolean }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/content${channel ? `?channel=${channel}` : ""}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "작업 목록을 불러오지 못했습니다.");
    else {
      const next = reviewMode ? data.filter((item: WorkItem) => item.status === "review_required") : data;
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

  async function update(id: string, patch: { status?: WorkflowStatus; review_note?: string }) {
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
          {item.content_review_assets?.length ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {item.content_review_assets.map((asset) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={asset.id} src={asset.public_url} alt={`${item.title} 검토 이미지`} className="w-full rounded-xl border border-[var(--line)]" />
              ))}
            </div>
          ) : null}
          {reviewMode && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <textarea className="input" rows={3} value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="수정 요청이나 가려야 할 내용을 적어주세요." />
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void update(item.id, { status: "creating", review_note: notes[item.id] || "" })} className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold">수정 요청</button>
                <button onClick={() => void update(item.id, { status: "approved", review_note: notes[item.id] || "" })} className="btn-gradient rounded-xl px-4 py-2 text-sm font-bold text-white">완성본 승인</button>
                <button onClick={() => void update(item.id, { status: "on_hold", review_note: notes[item.id] || "" })} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold">보류</button>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
