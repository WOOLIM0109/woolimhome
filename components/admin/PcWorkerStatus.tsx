"use client";

import { useEffect, useState } from "react";
import { Computer, Loader2, Power, RefreshCw } from "lucide-react";

type WorkerStatus = {
  configured: boolean;
  online: boolean;
  waitingCount: number;
  nextRunHint: string;
  worker: {
    status: string;
    current_job_id: string | null;
    last_seen_at: string;
    last_error: string | null;
    metadata?: { powerPointVersion?: string | null };
  } | null;
};

export default function PcWorkerStatus() {
  const [data, setData] = useState<WorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/pc-worker/status", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setData(payload);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="card mt-8 overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[var(--line)] bg-[#fff8f2] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Computer className="mt-1 text-[var(--primary)]" />
          <div>
            <h2 className="text-xl font-bold">사무실 PC 문서 변환기</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{data?.nextRunHint || "상태 확인 중"}</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold">
          {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} 새로고침
        </button>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs font-bold text-[var(--muted)]">PC 상태</p>
          <p className={`mt-2 flex items-center gap-2 font-bold ${data?.online ? "text-emerald-700" : "text-stone-500"}`}>
            <Power size={17} /> {data?.online ? (data.worker?.status === "busy" ? "온라인 · 변환 중" : "온라인") : "오프라인"}
          </p>
        </article>
        <article className="rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs font-bold text-[var(--muted)]">PC 변환 대기</p>
          <p className="mt-2 text-2xl font-black">{data?.waitingCount || 0}<span className="ml-1 text-sm">건</span></p>
        </article>
        <article className="rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs font-bold text-[var(--muted)]">마지막 연결</p>
          <p className="mt-2 text-sm font-bold">
            {data?.worker?.last_seen_at ? new Date(data.worker.last_seen_at).toLocaleString("ko-KR") : "연결 기록 없음"}
          </p>
        </article>
      </div>
      {data?.worker?.last_error && (
        <p className="mx-6 mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{data.worker.last_error}</p>
      )}
    </section>
  );
}
