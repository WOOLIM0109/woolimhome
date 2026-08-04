"use client";

import { useCallback, useEffect, useState } from "react";
import { Computer, Loader2, Power, RefreshCw } from "lucide-react";

type Worker = {
  id: string;
  display_name: string;
  status: string;
  online: boolean;
  busy: boolean;
  current_job_id: string | null;
  last_seen_at: string;
  last_error: string | null;
  metadata?: { powerPointVersion?: string | null } | null;
};

type WorkerStatus = {
  configured: boolean;
  online: boolean;
  busy: boolean;
  onlineCount: number;
  busyCount: number;
  workerCount: number;
  waitingCount: number;
  nextRunHint: string;
  workers: Worker[];
  worker?: Worker | null;
};

const statusLabel: Record<string, string> = {
  online: "온라인",
  busy: "변환 중",
  offline: "오프라인",
  error: "오류",
};

const statusColor: Record<string, string> = {
  online: "text-emerald-700",
  busy: "text-blue-700",
  offline: "text-stone-500",
  error: "text-red-700",
};

function formatLastSeen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "연결 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function PcWorkerStatus() {
  const [data, setData] = useState<WorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pc-worker/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "PC 상태를 확인하지 못했습니다.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "PC 상태 확인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [load]);

  const workers = data?.workers || (data?.worker ? [data.worker] : []);

  return (
    <section className="card mt-8 overflow-hidden" aria-labelledby="pc-worker-title" aria-busy={loading}>
      <div className="flex flex-col gap-4 border-b border-[var(--line)] bg-[#fff8f2] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Computer className="mt-1 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <div>
            <h2 id="pc-worker-title" className="text-xl font-bold">문서 변환 PC</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{data?.nextRunHint || "상태 확인 중"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          {loading ? "확인 중" : "새로고침"}
        </button>
      </div>

      <div className="p-6">
        <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
          <article className="rounded-xl border border-[var(--line)] p-4">
            <p className="text-xs font-bold text-[var(--muted)]">등록된 PC</p>
            <p className="mt-2 text-2xl font-black">{data?.workerCount ?? workers.length}<span className="ml-1 text-sm">대</span></p>
          </article>
          <article className="rounded-xl border border-[var(--line)] p-4">
            <p className="text-xs font-bold text-[var(--muted)]">현재 온라인</p>
            <p className="mt-2 text-2xl font-black text-emerald-700">
              {data?.onlineCount || 0}<span className="ml-1 text-sm">대</span>
              {(data?.busyCount || 0) > 0 && <span className="ml-2 text-xs text-blue-700">({data?.busyCount}대 변환 중)</span>}
            </p>
          </article>
          <article className="rounded-xl border border-[var(--line)] p-4">
            <p className="text-xs font-bold text-[var(--muted)]">변환 대기</p>
            <p className="mt-2 text-2xl font-black">{data?.waitingCount || 0}<span className="ml-1 text-sm">건</span></p>
          </article>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
            {error}
          </p>
        )}

        {!loading && data && !data.configured && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            서버에 PC 워커 비밀키를 등록해야 문서 변환 PC를 연결할 수 있습니다.
          </p>
        )}

        {!loading && !error && workers.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            아직 연결 기록이 없습니다. PC 워커를 실행하면 이곳에 PC별 상태가 표시됩니다.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {workers.map((worker, index) => {
              const headingId = `pc-worker-${index}`;
              const label = statusLabel[worker.status] || worker.status;
              return (
                <article key={worker.id} className="rounded-xl border border-[var(--line)] p-5" aria-labelledby={headingId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id={headingId} className="truncate font-bold" title={worker.display_name}>{worker.display_name}</h3>
                      <p className="mt-1 break-all text-xs text-[var(--muted)]">{worker.id}</p>
                    </div>
                    <p className={`flex shrink-0 items-center gap-1.5 text-sm font-bold ${statusColor[worker.status] || "text-stone-600"}`}>
                      <Power size={16} aria-hidden="true" /> {label}
                    </p>
                  </div>

                  <dl className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 text-sm">
                    <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
                      <dt className="font-bold text-[var(--muted)]">현재 작업</dt>
                      <dd>
                        {worker.current_job_id ? (
                          <code className="break-all text-xs" title={worker.current_job_id} aria-label={`현재 작업 ID ${worker.current_job_id}`}>
                            #{worker.current_job_id.slice(0, 8)}
                          </code>
                        ) : "없음"}
                      </dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
                      <dt className="font-bold text-[var(--muted)]">마지막 연결</dt>
                      <dd>
                        <time dateTime={worker.last_seen_at}>{formatLastSeen(worker.last_seen_at)}</time>
                      </dd>
                    </div>
                    {worker.metadata?.powerPointVersion && (
                      <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
                        <dt className="font-bold text-[var(--muted)]">PowerPoint</dt>
                        <dd>{worker.metadata.powerPointVersion}</dd>
                      </div>
                    )}
                  </dl>

                  {worker.last_error && (
                    <p className="mt-4 break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                      <span className="font-bold">마지막 오류:</span> {worker.last_error}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
