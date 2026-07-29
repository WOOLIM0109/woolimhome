"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  RefreshCw,
  Search,
} from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";

type RangeMode = "day" | "week" | "month" | "all";
interface KeyCount { key: string; count: number }
interface LogRow {
  bot_name: string;
  bot_category: string | null;
  bot_operator: string | null;
  page_kind: string | null;
  requested_path: string;
  ip_address: string | null;
  country: string | null;
  accessed_at: string;
}
interface DashboardData {
  total: number;
  sampled: number;
  truncated: boolean;
  aiHits: number;
  searchHits: number;
  uniqueBots: number;
  byCategory: KeyCount[];
  byBot: KeyCount[];
  byOperator: KeyCount[];
  byPageKind: KeyCount[];
  byCountry: KeyCount[];
  byPath: KeyCount[];
  timeseries: { day: string; total: number }[];
  matrix: { days: string[]; rows: { name: string; total: number; perDay: number[] }[] };
  dowHour: { dow: number; hour: number; count: number }[];
  recent: LogRow[];
  error?: string;
}

const PAGE_LABELS: Record<string, string> = {
  home: "홈",
  company: "회사소개",
  service: "사업영역",
  project: "프로젝트",
  case: "주요사례",
  column: "칼럼",
  news: "알림마당",
  contact: "상담신청",
  other: "기타",
};
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const COLORS = ["#ef762f", "#2f766d", "#326b9a", "#8a5d9f", "#be8a27", "#b84e5b", "#4f6f52", "#6d665f"];

function rangeFor(mode: RangeMode) {
  const to = new Date();
  if (mode === "all") return { from: new Date(0), to };
  if (mode === "day") return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to };
  if (mode === "week") return { from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), to };
  return { from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to };
}

function Donut({ rows }: { rows: KeyCount[] }) {
  const top = rows.slice(0, 7);
  const rest = rows.slice(7).reduce((sum, row) => sum + row.count, 0);
  const data = rest ? [...top, { key: "기타", count: rest }] : top;
  const total = data.reduce((sum, row) => sum + row.count, 0);
  let cursor = 0;
  const gradient = data.map((row, index) => {
    const start = total ? (cursor / total) * 100 : 0;
    cursor += row.count;
    const end = total ? (cursor / total) * 100 : 0;
    return `${COLORS[index % COLORS.length]} ${start}% ${end}%`;
  }).join(", ");
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div
        className="grid size-36 shrink-0 place-items-center rounded-full"
        style={{ background: total ? `conic-gradient(${gradient})` : "#eee8e3" }}
      >
        <div className="grid size-24 place-items-center rounded-full bg-white text-center">
          <strong className="text-xl">{total.toLocaleString()}</strong>
        </div>
      </div>
      <div className="w-full space-y-2">
        {data.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{row.key}</span>
            <strong>{row.count.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint: string }) {
  return (
    <article className="border border-[var(--line)] bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--muted)]">{icon}{label}</div>
      <p className="mt-3 text-3xl font-bold">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
    </article>
  );
}

function Ranking({ title, rows, label }: { title: string; rows: KeyCount[]; label?: (key: string) => string }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <article className="border border-[var(--line)] bg-white p-5">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-5 space-y-3">
        {rows.slice(0, 10).map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex justify-between gap-4 text-sm">
              <span className="truncate">{label ? label(row.key) : row.key}</span>
              <strong>{row.count.toLocaleString()}</strong>
            </div>
            <div className="h-2 bg-[#eee8e3]"><div className="h-2 bg-[#ef762f]" style={{ width: `${Math.max(2, row.count / max * 100)}%` }} /></div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>}
      </div>
    </article>
  );
}

function HourHeatmap({ rows }: { rows: DashboardData["dowHour"] }) {
  const map = new Map(rows.map((row) => [`${row.dow}-${row.hour}`, row.count]));
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <article className="overflow-x-auto border border-[var(--line)] bg-white p-5">
      <h2 className="font-bold">요일·시간대별 방문</h2>
      <table className="mt-4 min-w-[760px] text-center text-xs">
        <thead><tr><th className="p-1 text-left">요일</th>{Array.from({ length: 24 }, (_, hour) => <th key={hour} className="p-1 font-normal text-[var(--muted)]">{hour}</th>)}</tr></thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
            <tr key={dow}>
              <th className="p-1 text-left">{DOW_LABELS[dow]}</th>
              {Array.from({ length: 24 }, (_, hour) => {
                const count = map.get(`${dow}-${hour}`) || 0;
                return <td key={hour} className="size-7 border border-white p-1" title={`${DOW_LABELS[dow]}요일 ${hour}시 · ${count}회`} style={{ backgroundColor: count ? `rgba(239,118,47,${0.14 + count / max * 0.76})` : "#f7f4f1" }}>{count || ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function DailyMatrix({ matrix }: { matrix: DashboardData["matrix"] }) {
  const max = Math.max(...matrix.rows.flatMap((row) => row.perDay), 1);
  const visibleDays = matrix.days.slice(-31);
  const offset = Math.max(0, matrix.days.length - visibleDays.length);
  return (
    <article className="overflow-x-auto border border-[var(--line)] bg-white p-5">
      <h2 className="font-bold">일자별·봇별 방문</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">선택 기간이 길면 최근 31일을 표시합니다.</p>
      {matrix.rows.length ? (
        <table className="mt-4 min-w-[880px] text-center text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-2 text-left">봇</th>
              {visibleDays.map((day) => <th key={day} className="p-1 font-normal text-[var(--muted)]">{Number(day.slice(-2))}</th>)}
              <th className="p-2 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.name} className="border-t border-[var(--line)]">
                <th className="sticky left-0 z-10 max-w-40 truncate bg-white p-2 text-left" title={row.name}>{row.name}</th>
                {row.perDay.slice(offset).map((count, index) => (
                  <td
                    key={`${row.name}-${visibleDays[index]}`}
                    className="size-8 border border-white p-1"
                    title={`${visibleDays[index]} · ${row.name} · ${count}회`}
                    style={{ backgroundColor: count ? `rgba(47,118,109,${0.14 + count / max * 0.76})` : "#f7f4f1" }}
                  >
                    {count || ""}
                  </td>
                ))}
                <td className="p-2 text-right font-bold">{row.total.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-5 text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>}
    </article>
  );
}

export default function BotTrafficPage() {
  const [mode, setMode] = useState<RangeMode>("month");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const range = rangeFor(mode);
    try {
      const response = await fetch(`/api/admin/bot-traffic?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "봇 트래픽을 불러오지 못했습니다.");
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "봇 트래픽을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const maxDay = Math.max(...(data?.timeseries || []).map((row) => row.total), 1);
  const recentDays = useMemo(() => (data?.timeseries || []).slice(-31), [data]);

  return (
    <AdminPortal
      title="봇 트래픽"
      description="AI 서비스, 검색엔진, 소셜 미리보기와 자동화 도구가 울림 홈페이지의 어떤 페이지를 방문하는지 확인합니다."
      actions={(
        <>
          <div className="flex border border-[var(--line)] bg-white p-1">
            {(["day", "week", "month", "all"] as RangeMode[]).map((value) => (
              <button key={value} type="button" onClick={() => setMode(value)} className={`px-3 py-2 text-sm font-bold ${mode === value ? "bg-[#241a15] text-white" : "text-[var(--muted)]"}`}>
                {{ day: "24시간", week: "7일", month: "30일", all: "전체" }[value]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 border border-[var(--line)] bg-white px-4 py-2 font-bold disabled:opacity-50">
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} /> 새로고침
          </button>
        </>
      )}
    >
      {error && <div className="mt-6 flex gap-3 border border-amber-300 bg-amber-50 p-5 text-amber-950"><AlertTriangle className="shrink-0" /><div><strong>통계를 불러올 수 없습니다.</strong><p className="mt-1 text-sm">{error}</p></div></div>}
      {data?.truncated && <div className="mt-6 flex gap-3 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle size={19} className="shrink-0" />선택 기간의 {data.total.toLocaleString()}건 중 최근 {data.sampled.toLocaleString()}건을 기준으로 세부 통계를 표시합니다.</div>}

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Activity size={17} />} label="전체 봇 방문" value={data?.total || 0} hint="선택 기간의 감지 요청" />
        <StatCard icon={<BrainCircuit size={17} />} label="AI·LLM 봇" value={data?.aiHits || 0} hint="ChatGPT·Claude·Perplexity 등" />
        <StatCard icon={<Search size={17} />} label="검색엔진 봇" value={data?.searchHits || 0} hint="네이버·구글·빙 등" />
        <StatCard icon={<Bot size={17} />} label="확인된 봇 종류" value={data?.uniqueBots || 0} hint="서로 다른 봇 이름" />
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="border border-[var(--line)] bg-white p-5">
          <h2 className="font-bold">일별 방문 흐름</h2>
          <div className="mt-5 flex h-52 items-end gap-1 overflow-x-auto border-b border-[var(--line)] pb-1">
            {recentDays.map((row) => (
              <div key={row.day} className="group flex min-w-5 flex-1 flex-col items-center justify-end" title={`${row.day} · ${row.total}회`}>
                <span className="mb-1 hidden text-[10px] font-bold group-hover:block">{row.total}</span>
                <div className="w-full bg-[#ef762f]" style={{ height: `${Math.max(3, row.total / maxDay * 170)}px` }} />
              </div>
            ))}
            {!recentDays.length && <p className="m-auto text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>}
          </div>
          {!!recentDays.length && <div className="mt-2 flex justify-between text-xs text-[var(--muted)]"><span>{recentDays[0]?.day}</span><span>{recentDays[recentDays.length - 1]?.day}</span></div>}
        </article>
        <article className="border border-[var(--line)] bg-white p-5">
          <h2 className="font-bold">봇 유형 비율</h2>
          <div className="mt-5"><Donut rows={data?.byCategory || []} /></div>
        </article>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <Ranking title="많이 방문한 봇" rows={data?.byBot || []} />
        <Ranking title="많이 방문한 페이지 유형" rows={data?.byPageKind || []} label={(key) => PAGE_LABELS[key] || key} />
        <Ranking title="많이 방문한 경로" rows={data?.byPath || []} />
        <Ranking title="방문 국가" rows={data?.byCountry || []} />
      </section>

      <div className="mt-6"><DailyMatrix matrix={data?.matrix || { days: [], rows: [] }} /></div>
      <div className="mt-6"><HourHeatmap rows={data?.dowHour || []} /></div>

      <section className="mt-6 overflow-hidden border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] p-5"><h2 className="font-bold">최근 봇 방문 기록</h2><p className="mt-1 text-sm text-[var(--muted)]">IP는 개인정보 보호를 위해 일부가 가려져 저장됩니다.</p></div>
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="sticky top-0 bg-[#f7f4f1]"><tr><th className="p-3">시각</th><th className="p-3">봇</th><th className="p-3">운영사</th><th className="p-3">페이지</th><th className="p-3">경로</th><th className="p-3">국가</th><th className="p-3">IP</th></tr></thead>
            <tbody>
              {(data?.recent || []).map((row, index) => (
                <tr key={`${row.accessed_at}-${index}`} className="border-t border-[var(--line)]">
                  <td className="whitespace-nowrap p-3 text-[var(--muted)]">{new Date(row.accessed_at).toLocaleString("ko-KR", { hour12: false })}</td>
                  <td className="p-3 font-bold">{row.bot_name}</td>
                  <td className="p-3">{row.bot_operator || "-"}</td>
                  <td className="p-3">{PAGE_LABELS[row.page_kind || ""] || row.page_kind || "-"}</td>
                  <td className="max-w-[320px] truncate p-3 font-mono">{row.requested_path}</td>
                  <td className="p-3">{row.country || "-"}</td>
                  <td className="p-3 font-mono text-[var(--muted)]">{row.ip_address || "-"}</td>
                </tr>
              ))}
              {!data?.recent?.length && <tr><td colSpan={7} className="p-8 text-center text-[var(--muted)]">{loading ? "기록을 불러오는 중입니다." : "아직 감지된 봇 방문이 없습니다."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </AdminPortal>
  );
}
