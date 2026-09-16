"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, Files, RefreshCw, Trash2 } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";

type Entry = {
  key: string;
  label: string;
  action: "delete_rows" | "clear_fields" | "delete_files";
  afterDays: number;
  rows: number;
  files: number;
  remaining: boolean;
  warnings: string[];
  error: string | null;
};

type Run = {
  scheduleKey: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  totals: { rows: number; files: number; failed: number; remaining: number } | null;
  entries: Entry[];
};

type Policy = {
  key: string;
  label: string;
  action: Entry["action"];
  afterDays: number;
  basis: string;
  guard: string;
};

const ACTION_LABEL: Record<Entry["action"], string> = {
  delete_rows: "기록 삭제",
  clear_fields: "내용만 비움",
  delete_files: "파일 삭제",
};

function periodLabel(afterDays: number) {
  if (afterDays === 0) return "조건 충족 즉시";
  if (afterDays % 365 === 0) return `${afterDays / 365}년 뒤`;
  return `${afterDays}일 뒤`;
}

function formatMoment(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export default function RetentionPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [policy, setPolicy] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 첫 줄에서 곧바로 상태를 바꾸면 effect 가 연쇄로 다시 그립니다.
  // 불러오는 표시는 부르는 쪽에서 켜고, 여기서는 끝났을 때만 끕니다.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/retention", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "정리 기록을 불러오지 못했습니다.");
      setRuns(data.runs || []);
      setPolicy(data.policy || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정리 기록을 불러오지 못했습니다.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // 봇 트래픽 화면과 같은 방식입니다. 그리는 중에 곧바로 상태를 바꾸지 않고
    // 한 박자 뒤로 미뤄, 연쇄로 다시 그리는 것을 피합니다.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const latest = runs[0] || null;
  const touched = latest?.entries.filter((entry) => entry.rows || entry.files) || [];
  const failed = latest?.entries.filter((entry) => entry.error) || [];

  return (
    <AdminPortal
      title="데이터 정리"
      description="보관 기간이 지난 자료를 하루 한 번(새벽 5시 40분) 정리합니다. 무엇이 지워졌는지 여기서 확인합니다."
      actions={(
        <button
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold"
        >
          <RefreshCw size={18} /> 새로고침
        </button>
      )}
    >
      {error && (
        <p className="mt-8 rounded-xl border border-red-300 bg-red-50 p-4 font-bold text-red-800" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="mt-8">불러오는 중입니다.</p>}

      {!loading && !error && !latest && (
        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6">
          <p className="font-bold">아직 한 번도 정리하지 않았습니다.</p>
          <p className="prose-muted mt-2">
            매일 새벽 5시 40분에 처음으로 돕니다. 그때까지는 아래 표에 적힌 기준만 정해져 있는 상태입니다.
          </p>
        </section>
      )}

      {!loading && latest && (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-bold text-[var(--muted)]">마지막 정리</p>
              <p className="mt-2 text-lg font-bold">{formatMoment(latest.completedAt || latest.startedAt)}</p>
              <p className={`mt-1 inline-flex items-center gap-1.5 text-sm font-bold ${
                latest.status === "completed" ? "text-emerald-700" : "text-red-700"
              }`}>
                {latest.status === "completed"
                  ? <><Check size={15} /> 정상 완료</>
                  : <><AlertTriangle size={15} /> {latest.status}</>}
              </p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-bold text-[var(--muted)]">지운 기록</p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{(latest.totals?.rows ?? 0).toLocaleString("ko-KR")}</p>
              <p className="prose-muted mt-1 text-sm">건</p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-bold text-[var(--muted)]">지운 파일</p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{(latest.totals?.files ?? 0).toLocaleString("ko-KR")}</p>
              <p className="prose-muted mt-1 text-sm">개 · 슬라이드와 원본 문서</p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-bold text-[var(--muted)]">다음으로 넘긴 것</p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{latest.totals?.remaining ?? 0}</p>
              <p className="prose-muted mt-1 text-sm">
                {latest.totals?.remaining ? "한 번에 다 지우지 않아 내일 이어서 처리합니다." : "남은 것 없이 끝났습니다."}
              </p>
            </article>
          </section>

          {failed.length > 0 && (
            <section className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-red-800">
                <AlertTriangle size={18} /> 막힌 규칙 {failed.length}개
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-red-900">
                {failed.map((entry) => (
                  <li key={entry.key}><b>{entry.label}</b> — {entry.error}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-xl font-bold">이번에 정리한 것</h2>
            {touched.length === 0 ? (
              <p className="prose-muted mt-3">
                기간이 지난 자료가 없어 지운 것이 없습니다. 정상입니다.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th className="px-5 py-3 font-bold">대상</th>
                      <th className="px-5 py-3 font-bold">방식</th>
                      <th className="px-5 py-3 font-bold">기준</th>
                      <th className="px-5 py-3 text-right font-bold">기록</th>
                      <th className="px-5 py-3 text-right font-bold">파일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {touched.map((entry) => (
                      <tr key={entry.key} className="border-b border-[var(--line)] last:border-b-0">
                        <td className="px-5 py-4 font-bold">
                          {entry.label}
                          {entry.remaining && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                              <Clock size={11} /> 이어서
                            </span>
                          )}
                          {entry.warnings.map((warning) => (
                            <span key={warning} className="mt-1 block text-xs font-normal text-amber-800">{warning}</span>
                          ))}
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
                            {entry.action === "delete_files" ? <Files size={14} /> : <Trash2 size={14} />}
                            {ACTION_LABEL[entry.action]}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[var(--muted)]">{periodLabel(entry.afterDays)}</td>
                        <td className="px-5 py-4 text-right font-bold tabular-nums">{entry.rows.toLocaleString("ko-KR")}</td>
                        <td className="px-5 py-4 text-right font-bold tabular-nums">
                          {entry.files ? entry.files.toLocaleString("ko-KR") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {runs.length > 1 && (
            <section className="mt-10">
              <h2 className="text-xl font-bold">지난 기록</h2>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th className="px-5 py-3 font-bold">날짜</th>
                      <th className="px-5 py-3 font-bold">상태</th>
                      <th className="px-5 py-3 text-right font-bold">기록</th>
                      <th className="px-5 py-3 text-right font-bold">파일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.slice(1).map((run) => (
                      <tr key={run.scheduleKey} className="border-b border-[var(--line)] last:border-b-0">
                        <td className="px-5 py-3 font-bold tabular-nums">{run.scheduleKey}</td>
                        <td className={`px-5 py-3 font-bold ${run.status === "completed" ? "text-emerald-700" : "text-red-700"}`}>
                          {run.status === "completed" ? "정상" : run.status}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{(run.totals?.rows ?? 0).toLocaleString("ko-KR")}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{(run.totals?.files ?? 0).toLocaleString("ko-KR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {!loading && policy.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">정리 기준</h2>
          <p className="prose-muted mt-2 max-w-3xl">
            무엇을 언제 지우는지 정해 둔 표입니다. 기간을 바꾸려면 알려 주세요.
            되돌릴 수 없는 일이라, 지키는 조건도 함께 적어 두었습니다.
          </p>
          <div className="mt-4 space-y-3">
            {policy.map((rule) => (
              <details key={rule.key} className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <summary className="cursor-pointer font-bold">
                  {rule.label}
                  <span className="ml-3 text-sm font-normal text-[var(--muted)]">
                    {rule.basis}부터 {periodLabel(rule.afterDays)} · {ACTION_LABEL[rule.action]}
                  </span>
                </summary>
                <p className="prose-muted mt-3 text-sm leading-6">{rule.guard}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </AdminPortal>
  );
}
