"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, LoaderCircle, Play, RefreshCw, Save, X } from "lucide-react";
import { CONTENT_STATUS_LABELS, MORNING_PROGRAM_LIMIT, PROGRAM_STATUS_LABELS } from "@/lib/openchat/config";
import { formatAfternoonPost, formatMorningPost } from "@/lib/openchat/post-format";
import type { OpenchatContentDraft, OpenchatProgram, OpenchatSource } from "@/lib/openchat/types";
import OpenchatPushControl from "./OpenchatPushControl";

type Tab = "morning" | "afternoon" | "sources";
type SourcePayload = {
  sources: OpenchatSource[];
  runs: Array<{ id: string; task: string; status: string; started_at: string; error?: string | null }>;
};

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function statusClass(status: string) {
  if (["approved", "ready", "published"].includes(status)) return "bg-emerald-50 text-emerald-800";
  if (["excluded", "on_hold"].includes(status)) return "bg-red-50 text-red-800";
  if (status === "deferred") return "bg-stone-100 text-stone-700";
  return "bg-amber-50 text-amber-900";
}

function toKstDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function fromKstDateTimeInput(value: string) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}

export default function OpenchatOperations() {
  const [tab, setTab] = useState<Tab>("morning");
  const [date, setDate] = useState(todayKst);
  const [programs, setPrograms] = useState<OpenchatProgram[]>([]);
  const [draft, setDraft] = useState<OpenchatContentDraft | null>(null);
  const [sources, setSources] = useState<SourcePayload>({ sources: [], runs: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [programResponse, contentResponse, sourceResponse] = await Promise.all([
        fetch(`/api/admin/openchat/programs?date=${date}`, { cache: "no-store" }),
        fetch(`/api/admin/openchat/content?date=${date}`, { cache: "no-store" }),
        fetch("/api/admin/openchat/sources", { cache: "no-store" }),
      ]);
      const [programData, contentData, sourceData] = await Promise.all([
        programResponse.json(), contentResponse.json(), sourceResponse.json(),
      ]);
      if (!programResponse.ok) throw new Error(programData.error || "공고를 불러오지 못했습니다.");
      if (!contentResponse.ok) throw new Error(contentData.error || "콘텐츠를 불러오지 못했습니다.");
      if (!sourceResponse.ok) throw new Error(sourceData.error || "출처 현황을 불러오지 못했습니다.");
      setPrograms(programData);
      setDraft(contentData);
      setSources(sourceData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedPrograms = useMemo(() => programs
    .filter((program) => program.status === "approved" || program.status === "ready")
    .sort((left, right) => left.priority - right.priority)
    .slice(0, MORNING_PROGRAM_LIMIT), [programs]);

  const reviewPrograms = useMemo(() => programs
    .filter((program) => !["deferred", "excluded"].includes(program.status))
    .sort((left, right) => left.priority - right.priority)
    .slice(0, MORNING_PROGRAM_LIMIT), [programs]);

  async function run(task: string) {
    setBusy(task);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/openchat/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, date }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "작업을 실행하지 못했습니다.");
      setMessage("작업이 완료되었습니다.");
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "작업 실행 실패");
    } finally {
      setBusy("");
    }
  }

  async function saveProgram(program: OpenchatProgram, status?: OpenchatProgram["status"]) {
    if (status === "approved" && selectedPrograms.length >= MORNING_PROGRAM_LIMIT && program.status !== "approved") {
      setError(`하루 승인 상한은 ${MORNING_PROGRAM_LIMIT}건입니다.`);
      return;
    }
    setBusy(program.id);
    const response = await fetch("/api/admin/openchat/programs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...program, status: status || program.status }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || "공고를 저장하지 못했습니다.");
    else setPrograms((current) => current.map((item) => item.id === program.id ? data : item));
    setBusy("");
  }

  async function saveDraft(status?: OpenchatContentDraft["status"]) {
    if (!draft) return;
    setBusy(draft.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/openchat/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, status: status || draft.status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "콘텐츠를 저장하지 못했습니다.");
      setDraft(data);
      setMessage(status === "approved"
        ? "오후 콘텐츠를 승인했습니다. 오후 6시에 게시 준비 상태로 전환됩니다."
        : status === "deferred"
          ? "오늘 게시 대상에서 제외했습니다."
          : status === "published"
            ? "게시 완료 상태로 변경했습니다."
            : "오후 콘텐츠 수정사항을 저장했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "콘텐츠를 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function replaceDraft() {
    if (!draft || !window.confirm("현재 초안을 삭제하고 과거 글과 겹치지 않는 다른 주제로 다시 만들까요?")) return;
    setBusy("replace-afternoon");
    setError("");
    try {
      const response = await fetch("/api/admin/openchat/content", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "기존 초안을 정리하지 못했습니다.");
      setDraft(null);
      await run("afternoon-draft");
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : "다른 주제를 만들지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage("카카오톡 게시문을 클립보드에 복사했습니다.");
  }

  async function toggleSource(source: OpenchatSource) {
    const response = await fetch("/api/admin/openchat/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, enabled: !source.enabled }),
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || "출처 설정을 저장하지 못했습니다.");
      return;
    }
    await load();
  }

  return (
    <div className="mt-8">
      <section className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex flex-wrap gap-2">
          {(["morning", "afternoon", "sources"] as Tab[]).map((value) => (
            <button key={value} onClick={() => setTab(value)} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === value ? "bg-[#241a15] text-white" : "border border-[var(--line)] bg-white"}`}>
              {value === "morning" ? "오전 지원사업" : value === "afternoon" ? "오후 콘텐츠" : "수집 현황"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-[var(--muted)]">작업일<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input mt-1 block" /></label>
          <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold"><RefreshCw size={16} /> 새로고침</button>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-bold">정시 브라우저 알림</p><p className="mt-1 text-sm text-[var(--muted)]">초안 등록, 승인 마감, 게시 준비 시각에 알림을 받습니다.</p></div>
          <OpenchatPushControl />
        </div>
      </section>

      {message && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{message}</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
      {loading ? <p className="mt-8 text-sm text-[var(--muted)]">자료를 불러오고 있습니다.</p> : null}

      {!loading && tab === "morning" && (
        <section className="mt-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold">오전 공고 검토</h2>
              <p className="mt-1 text-sm text-orange-900/80">승인 {selectedPrograms.length}/{MORNING_PROGRAM_LIMIT}건 · 검토 후보 {reviewPrograms.length}건 · 오전 10:15 미승인 공고는 다음 영업일로 이월</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void run("morning-collect")} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-orange-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"><Play size={16} /> 지금 수집</button>
              <button onClick={() => void copy(formatMorningPost(selectedPrograms, date))} disabled={!selectedPrograms.length} className="inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50"><Clipboard size={16} /> 게시문 복사</button>
            </div>
          </div>
          {reviewPrograms.length > 0 && (
            <details className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5">
              <summary className="cursor-pointer font-bold">검토용 게시문 통합 미리보기 · {reviewPrograms.length}건 · 상담 문구 포함</summary>
              <pre className="mt-5 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#fff7f1] p-5 text-sm leading-7">{formatMorningPost(reviewPrograms, date)}</pre>
              <div className="mt-5 border-t border-[var(--line)] pt-5">
                <h3 className="font-bold">원문 링크</h3>
                <div className="mt-3 space-y-3">
                  {reviewPrograms.map((program, index) => (
                    <div key={program.id} className="rounded-xl bg-[#fff7f1] px-4 py-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <a href={program.source_url} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-2 text-sm font-bold text-[var(--primary)]">
                          <span className="shrink-0">{index + 1}.</span>
                          <span className="min-w-0 break-all">{program.title}<br /><span className="font-normal text-[var(--muted)]">{program.source_url}</span></span>
                          <ExternalLink size={15} className="mt-0.5 shrink-0" />
                        </a>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-2 text-xs font-bold ${statusClass(program.status)}`}>{PROGRAM_STATUS_LABELS[program.status]}</span>
                          {!['approved', 'ready', 'published'].includes(program.status) && <button onClick={() => void saveProgram(program, "approved")} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white">승인</button>}
                          <button onClick={() => void saveProgram(program, "deferred")} className="rounded-xl bg-stone-100 px-3 py-2 text-xs font-bold">이월</button>
                          <button onClick={() => void saveProgram(program, "excluded")} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">제외</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
          {!programs.length ? <p className="mt-5 rounded-xl border border-dashed border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)]">이 날짜의 수집 공고가 없습니다.</p> : (
            <details className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5">
              <summary className="cursor-pointer font-bold">세부 내용 직접 수정 · {programs.length}건</summary>
              <div className="mt-5 space-y-4">
              {programs.map((program, index) => (
                <article key={program.id} className="card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-bold text-[var(--primary)]">공고 {index + 1}</p>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(program.status)}`}>{PROGRAM_STATUS_LABELS[program.status]}</span>
                  </div>
                  <input className="input mt-4 font-bold" value={program.title} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, title: event.target.value } : item))} />
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="text-xs font-bold text-[var(--muted)]">신청대상<textarea className="input mt-1 min-h-28" value={program.applicant_summary} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, applicant_summary: event.target.value } : item))} /></label>
                    <label className="text-xs font-bold text-[var(--muted)]">지원내용<textarea className="input mt-1 min-h-28" value={program.support_summary} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, support_summary: event.target.value } : item))} /></label>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_120px]">
                    <label className="text-xs font-bold text-[var(--muted)]">접수방법<input className="input mt-1" value={program.application_method} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, application_method: event.target.value } : item))} /></label>
                    <label className="text-xs font-bold text-[var(--muted)]">우선순위<input type="number" className="input mt-1" value={program.priority} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, priority: Number(event.target.value) } : item))} /></label>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <label className="text-xs font-bold text-[var(--muted)]">신청 시작<input type="datetime-local" className="input mt-1" value={toKstDateTimeInput(program.starts_at)} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, starts_at: fromKstDateTimeInput(event.target.value) } : item))} /></label>
                    <label className="text-xs font-bold text-[var(--muted)]">신청 마감<input type="datetime-local" className="input mt-1" value={toKstDateTimeInput(program.deadline_at)} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, deadline_at: fromKstDateTimeInput(event.target.value) } : item))} /></label>
                  </div>
                  <label className="mt-4 block text-xs font-bold text-[var(--muted)]">신청기간 직접표기<input className="input mt-1" placeholder="상시접수·예산소진 등 날짜 대신 쓸 문구" value={program.application_period_text || ""} onChange={(event) => setPrograms((current) => current.map((item) => item.id === program.id ? { ...item, application_period_text: event.target.value } : item))} /></label>
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
                    <button onClick={() => void saveProgram(program)} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold"><Save size={15} /> 수정 저장</button>
                    <button onClick={() => void saveProgram(program, "approved")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"><Check size={15} /> 승인</button>
                    <button onClick={() => void saveProgram(program, "deferred")} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold">이월</button>
                    <button onClick={() => void saveProgram(program, "excluded")} className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700"><X size={15} /> 제외</button>
                    {program.status === "ready" && <button onClick={() => void saveProgram(program, "published")} className="rounded-xl bg-[#241a15] px-4 py-2 text-sm font-bold text-white">게시 완료</button>}
                  </div>
                  {busy === program.id && <p className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle size={14} className="animate-spin" /> 저장 중</p>}
                </article>
              ))}
              </div>
            </details>
          )}
        </section>
      )}

      {!loading && tab === "afternoon" && (
        <section className="mt-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-violet-50 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="text-xl font-bold">오후 콘텐츠 검토</h2><p className="mt-1 text-sm text-violet-900/80">오후 3시 초안 · 오후 5:30 승인 마감 · 오후 6시 게시 준비</p></div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void run("afternoon-draft")} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-violet-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"><Play size={16} /> 초안 생성</button>
              {draft && <button onClick={() => void replaceDraft()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50"><RefreshCw size={16} /> 다른 주제</button>}
              <button onClick={() => draft && void copy(formatAfternoonPost(draft))} disabled={!draft} className="inline-flex items-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50"><Clipboard size={16} /> 게시문 복사</button>
            </div>
          </div>
          {!draft ? <p className="mt-5 rounded-xl border border-dashed border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)]">이 날짜의 오후 콘텐츠 초안이 없습니다.</p> : (
            <article className="card mt-5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-[var(--primary)]">{draft.weekday_theme}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(draft.status)}`}>{CONTENT_STATUS_LABELS[draft.status]}</span>
              </div>
              <label className="mt-5 block text-xs font-bold text-[var(--muted)]">제목<input className="input mt-1 text-lg font-bold" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label className="mt-4 block text-xs font-bold text-[var(--muted)]">본문<textarea className="input mt-1 min-h-[460px] whitespace-pre-wrap leading-7" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
              <label className="mt-4 block text-xs font-bold text-[var(--muted)]">참고 링크<textarea className="input mt-1 min-h-24" value={draft.reference_urls.join("\n")} onChange={(event) => setDraft({ ...draft, reference_urls: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} /></label>
              <details open className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5">
                <summary className="cursor-pointer font-bold">카카오톡 최종 게시문 미리보기 · 상담 문구 포함</summary>
                <pre className="mt-5 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f7f3ff] p-5 text-sm leading-7">{formatAfternoonPost(draft)}</pre>
              </details>
              <div className={`mt-4 rounded-xl p-4 text-sm ${draft.similarity_score >= 48 ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
                과거 콘텐츠 중복 위험 {draft.similarity_score}점 {draft.review_note ? `· ${draft.review_note}` : "· 자동 검사 통과"}
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
                <button onClick={() => void saveDraft()} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} /> 수정 저장</button>
                <button onClick={() => void saveDraft("approved")} disabled={Boolean(busy) || ["approved", "ready", "published"].includes(draft.status)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-emerald-100 disabled:text-emerald-800">
                  {busy === draft.id ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                  {["approved", "ready", "published"].includes(draft.status) ? "승인 완료" : busy === draft.id ? "승인 처리 중" : "승인"}
                </button>
                <button onClick={() => void saveDraft("deferred")} disabled={Boolean(busy)} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">오늘 게시 제외</button>
                {draft.status === "ready" && <button onClick={() => void saveDraft("published")} disabled={Boolean(busy)} className="rounded-xl bg-[#241a15] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">게시 완료</button>}
              </div>
            </article>
          )}
        </section>
      )}

      {!loading && tab === "sources" && (
        <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="card p-6">
            <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">21개 수집처</h2><p className="mt-1 text-sm text-[var(--muted)]">매일 한 번 확인하며 사이트별 실패가 다른 수집을 중단시키지 않습니다.</p></div><button onClick={() => void run("morning-collect")} className="rounded-xl bg-[#241a15] px-4 py-3 text-sm font-bold text-white">전체 수집</button></div>
            <div className="mt-5 divide-y divide-[var(--line)]">
              {sources.sources.map((source) => (
                <div key={source.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-bold">{source.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{source.category} · {source.last_checked_at ? new Date(source.last_checked_at).toLocaleString("ko-KR") : "아직 확인 전"}{source.last_error ? ` · ${source.last_error}` : ""}</p></div>
                  <button onClick={() => void toggleSource(source)} className={`rounded-full px-3 py-2 text-xs font-bold ${source.enabled ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{source.enabled ? "수집 사용" : "수집 중지"}</button>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-6"><h2 className="text-xl font-bold">최근 자동화 기록</h2><div className="mt-5 space-y-3">{sources.runs.map((run) => <div key={run.id} className="rounded-xl bg-[#fff7f1] p-4"><p className="font-bold">{run.task}</p><p className="mt-1 text-xs text-[var(--muted)]">{new Date(run.started_at).toLocaleString("ko-KR")} · {run.status}{run.error ? ` · ${run.error}` : ""}</p></div>)}</div></div>
        </section>
      )}
    </div>
  );
}
