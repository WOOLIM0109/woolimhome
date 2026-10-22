"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, FileSearch, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { continuePortfolioPreparation } from "./portfolio-progress";
import { candidateInspectionLabel, candidateProductionBlockReason } from "./portfolio-candidate-state";

type Candidate = {
  id: string;
  project_name: string;
  status: string;
  quality_score: number;
  privacy_risk: string;
  font_status: string;
  fileName: string;
  fileSize: number;
  normalizedProjectName: string;
  fontExclusionReason?: string | null;
  selection_reasons: string[];
  exclusion_reasons?: string[];
  metadata?: { inspectionState?: string; sourceInspectionFailure?: { reason?: string }; imageReviewReason?: string; fontReviewReason?: string; duplicateMatch?: { title: string; url?: string; candidateId?: string } };
};

type StatusPayload = {
  configured: boolean;
  connection: {
    status: string;
    connected_by?: string;
    connected_at?: string;
    last_refreshed_at?: string;
    last_error?: string;
  };
  fileCount: number;
  /** 아직 쓰지 않고 기다리는 후보. 0 이면 다음 회차가 빈손이 됩니다. */
  candidateCount: number;
  /** 승인 폴더 안에서 지켜보는 전체 건수 (제외·사용 완료 포함). */
  trackedCount?: number;
  statusCounts?: Record<string, number>;
  inspectionSummary?: { producible: number; pending: number; noPreview: number; tooLarge: number; failed: number };
  activePortfolioCount?: number;
  heldPortfolioItems?: { id: string; title: string; status: string }[];
  candidates: Candidate[];
  error?: string;
};

/** 후보 상태를 사람 말로 옮깁니다. */
const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  candidate: "대기",
  selected: "제작 중",
  processed: "사용 완료",
  excluded: "제외",
  on_hold: "보류",
};

export default function NaverWorksDrivePanel() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateMatch, setDuplicateMatch] = useState<{ title: string; url: string } | null>(null);
  const [publishedCandidate, setPublishedCandidate] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [publishedTitle, setPublishedTitle] = useState("");
  const [savingPublication, setSavingPublication] = useState(false);

  async function registerPublished() {
    setSavingPublication(true);
    try {
      const response = await fetch(`/api/admin/naver-works/candidates/${publishedCandidate}/published`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: publishedUrl, title: publishedTitle }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "발행 원장 등록 실패");
      setPublishedCandidate(null); setPublishedUrl(""); setPublishedTitle("");
      await loadStatus();
    } catch (error) { setMessage(error instanceof Error ? error.message : "등록 실패"); }
    finally { setSavingPublication(false); }
  }

  /** 상태별 내역을 사람 말로 한 줄로 적습니다. */
  const statusBreakdown = Object.entries(data?.statusCounts || {})
    .filter(([status]) => status !== "candidate")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([status, count]) => `${CANDIDATE_STATUS_LABELS[status] || status} ${count}`)
    .join(" · ");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/naver-works/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "연결 상태를 확인하지 못했습니다.");
      setData(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결 상태 확인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  async function syncNow() {
    setSyncing(true);
    setMessage("");
    setDuplicateMatch(null);
    try {
      const response = await fetch("/api/admin/naver-works/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "동기화에 실패했습니다.");
      const cleanupText = payload.cleanup?.excludedCandidates
        ? ` 폴더 밖 후보 ${payload.cleanup.excludedCandidates}개는 제외하되, 기존 작업 ${payload.cleanup.preservedWorkItems || 0}개는 보존했습니다.`
        : "";
      setMessage(`파일 ${payload.indexed}개를 확인했고 지정된 PPT 폴더에서 포트폴리오 가능 파일 ${payload.supported}개를 찾았습니다.${cleanupText}`);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "동기화에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  }

  async function prepareNext() {
    setPreparing(true);
    setMessage("");
    setDuplicateMatch(null);
    try {
      const progress = await continuePortfolioPreparation({ requestId: crypto.randomUUID(), onProgress: payload => setMessage(payload.message) });
      if (progress.stage && !["inspecting", "empty", "cancelled"].includes(progress.stage)) {
        window.setTimeout(() => window.location.reload(), 800);
      }
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "포트폴리오 준비에 실패했습니다.");
    } finally {
      setPreparing(false);
    }
  }

  async function produceCandidate(candidate: Candidate) {
    const confirmed = window.confirm(`이 후보로 제작할까요?\n\n파일명: ${candidate.fileName}\n정규화 이름: ${candidate.normalizedProjectName || "확인 필요"}\n\n진행하면 회사 PC가 이 파일을 열어 변환하고 AI 본문 비용이 듭니다. 완성된 초안은 발행 전 검수를 거칩니다.`);
    if (!confirmed) return;
    const requestId = crypto.randomUUID();
    setPreparing(true);
    setMessage(`${candidate.fileName} 원본과 중복 여부를 확인하고 있습니다.`);
    setDuplicateMatch(null);
    try {
      const response = await fetch(`/api/admin/naver-works/candidates/${candidate.id}/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (typeof payload.duplicateMatch?.url === "string" && payload.duplicateMatch.url.startsWith("https://blog.naver.com/wl_0109/")) {
          setDuplicateMatch({ title: payload.duplicateMatch.title || "겹친 기존 글", url: payload.duplicateMatch.url });
        }
        throw new Error(payload.error || "지정한 후보로 제작을 시작하지 못했습니다.");
      }
      setMessage(payload.message);
      if (payload.shouldContinue) {
        await continuePortfolioPreparation({ requestId, onProgress: progress => setMessage(progress.message) });
      }
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "지정한 후보로 제작을 시작하지 못했습니다.");
    } finally {
      await loadStatus();
      setPreparing(false);
    }
  }

  const connected = data?.connection?.status === "connected";
  const heldPortfolioItems = data?.heldPortfolioItems || [];

  return (
    <section className="card mt-8 overflow-hidden">
      <div className="border-b border-[var(--line)] bg-[#fff8f2] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-3">
            <Cloud className="mt-1 shrink-0 text-[var(--primary)]" />
            <div>
              <h2 className="text-xl font-bold">NAVER WORKS 프로젝트 자료 자동 수집</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                Drive의 완성본_외부공유금지/PPT 폴더만 읽기 전용으로 확인합니다. 레퍼런스와 다른 폴더의 자료는 후보에서 제외합니다.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/admin/naver-works/connect"
              className="rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-white"
            >
              {connected ? "NAVER WORKS 다시 연결" : "NAVER WORKS 연결"}
            </a>
            <button
              type="button"
              disabled={!connected || syncing}
              onClick={syncNow}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              지금 동기화
            </button>
            <button
              type="button"
              disabled={!connected || preparing || Boolean(data?.activePortfolioCount)}
              onClick={prepareNext}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--primary)] bg-white px-4 py-3 text-sm font-bold text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {preparing ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
              다음 포트폴리오 준비
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /> 상태 확인 중</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-[var(--line)] p-4">
                <p className="text-xs font-bold text-[var(--muted)]">연결 상태</p>
                <p className="mt-2 font-bold">{connected ? "연결됨" : data?.configured ? "연결 대기" : "환경설정 필요"}</p>
              </article>
              <article className="rounded-xl border border-[var(--line)] p-4">
                <p className="text-xs font-bold text-[var(--muted)]">확인한 파일</p>
                <p className="mt-2 text-2xl font-black">{data?.fileCount || 0}<span className="ml-1 text-sm">개</span></p>
              </article>
              {/*
                * '대기 중인 후보'는 아직 쓰지 않은 것만 셉니다.
                *
                * 예전에는 제외된 것과 이미 다 쓴 것까지 합쳐서 셌습니다. 그래서 실제로
                * 쓸 수 있는 후보가 0 이던 22 일 동안에도 '후보 21개'가 떠 있었고,
                * 넉넉해 보이는 숫자 때문에 아무도 후보가 마른 줄 몰랐습니다.
                */}
              <article className="rounded-xl border border-[var(--line)] p-4">
                <p className="text-xs font-bold text-[var(--muted)]">대기 중인 후보</p>
                <p className={`mt-2 text-2xl font-black ${data?.candidateCount ? "" : "text-red-600"}`}>
                  {data?.candidateCount || 0}<span className="ml-1 text-sm">개</span>
                </p>
                {typeof data?.trackedCount === "number" && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    지켜보는 전체 {data.trackedCount}개
                    {statusBreakdown ? ` · ${statusBreakdown}` : ""}
                  </p>
                )}
                {data && !data.candidateCount && (
                  <p className="mt-2 text-xs font-bold text-red-600">
                    쓸 수 있는 후보가 없습니다. 지금 동기화를 눌러 주세요.
                  </p>
                )}
              </article>
            </div>

            {!data?.configured && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                NAVER WORKS Developer Console의 Client ID와 Client Secret을 서버에 등록하면 연결 버튼이 활성화됩니다.
              </div>
            )}

            {message && <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-[#f7f7f7] p-4 text-sm">{message}</p>}
            {duplicateMatch && <a className="mt-2 inline-block text-sm underline" href={duplicateMatch.url}>겹친 기존 글: {duplicateMatch.title}</a>}
            {data?.connection?.last_error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                마지막 오류: {data.connection.last_error}
              </p>
            )}

            <div className="mt-7 flex items-center gap-2">
              <FileSearch className="text-[var(--primary)]" size={20} />
              <h3 className="font-bold">자동 선별된 최근 후보</h3>
            </div>
            {data?.inspectionSummary && <p className="mt-2 text-sm text-[var(--muted)]">
              대기 후보 {data.candidateCount}개 · 제작 가능 {data.inspectionSummary.producible} · 검사 전 {data.inspectionSummary.pending} · 미리보기 없음 {data.inspectionSummary.noPreview} · 큰 파일 {data.inspectionSummary.tooLarge} · 원본 확인 실패 {data.inspectionSummary.failed}
            </p>}
            {heldPortfolioItems.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              검수 필요·보류 작업 {heldPortfolioItems.length}건: {heldPortfolioItems.map(item => item.title).join(" · ")}. 기존 작업 큐에서 실패 사유를 확인해 주세요. 페이지 구성 판정에서 제외된 작업은 자동으로 다시 처리하지 않습니다.
            </div>}
            {data?.candidates?.length ? (
              <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                {data.candidates.map((candidate) => {
                  const blockedReason = candidateProductionBlockReason(candidate, { connected, activePortfolioCount: data.activePortfolioCount || 0, preparing });
                  const inspectionLabel = candidateInspectionLabel(candidate);
                  return (
                  <article id={`candidate-${candidate.id}`} key={candidate.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-bold">{candidate.project_name}</h4>
                      {candidate.status === "candidate" && inspectionLabel && <p className="text-sm text-amber-800">{inspectionLabel}</p>}
                      {candidate.status === "candidate" && <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button type="button" disabled={Boolean(blockedReason)} title={blockedReason || undefined}
                          className="rounded-lg border border-[var(--primary)] px-3 py-2 text-sm font-bold text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void produceCandidate(candidate)}>이 후보로 제작</button>
                        <button type="button" className="text-sm underline" onClick={() => setPublishedCandidate(candidate.id)}>이미 블로그에 있음</button>
                        {blockedReason && <p className="text-xs text-[var(--muted)]">{blockedReason}</p>}
                      </div>}
                      {candidate.status === "excluded" && <details className="mt-2 text-sm"><summary>중복·제외 사유 보기</summary>
                        {(candidate.exclusion_reasons || []).map(reason => <p key={reason}>{reason}</p>)}
                        {candidate.metadata?.duplicateMatch && <a className="underline" href={candidate.metadata.duplicateMatch.url?.startsWith("https://blog.naver.com/wl_0109/")
                          ? candidate.metadata.duplicateMatch.url : `#candidate-${candidate.metadata.duplicateMatch.candidateId || ""}`}>{candidate.metadata.duplicateMatch.title}</a>}
                      </details>}
                      {publishedCandidate === candidate.id && <div className="mt-2 grid gap-2">
                        <input aria-label="기존 블로그 글 URL" placeholder="https://blog.naver.com/wl_0109/..." value={publishedUrl} onChange={event => setPublishedUrl(event.target.value)} className="rounded border p-2" />
                        <input aria-label="기존 블로그 글 제목" placeholder="기존 글 제목" value={publishedTitle} onChange={event => setPublishedTitle(event.target.value)} className="rounded border p-2" />
                        <button type="button" disabled={savingPublication || !publishedTitle.trim() || !publishedUrl.trim()} onClick={() => void registerPublished()}>원장 등록 및 후보 제외</button>
                        <button type="button" onClick={() => setPublishedCandidate(null)}>취소</button>
                      </div>}
                      <p className="mt-1 text-xs text-[var(--muted)]">{(candidate.selection_reasons || []).join(" · ")}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="rounded-full bg-[#fff3e9] px-3 py-1.5">적합도 {Math.round(candidate.quality_score)}점</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1.5">{candidate.status === "excluded" && candidate.exclusion_reasons?.some(reason => reason.startsWith("중복:")) ? "중복 제외" : CANDIDATE_STATUS_LABELS[candidate.status] || candidate.status}</span>
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 flex gap-3 rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
                <ShieldCheck className="shrink-0" size={20} />
                연결 후 동기화하면 프로젝트 후보와 선정 이유가 여기에 표시됩니다.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
