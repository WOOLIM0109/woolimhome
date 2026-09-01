"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, FileSearch, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

type Candidate = {
  id: string;
  project_name: string;
  status: string;
  quality_score: number;
  privacy_risk: string;
  font_status: string;
  selection_reasons: string[];
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
    try {
      let finalMessage = "";
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await fetch("/api/admin/naver-works/prepare", { method: "POST" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "포트폴리오 준비에 실패했습니다.");
        finalMessage = payload.message;
        setMessage(`${payload.message}${payload.shouldContinue ? ` · ${attempt + 1}단계 처리 중` : ""}`);
        if (!payload.shouldContinue || payload.stage === "review") break;
        await new Promise((resolve) => window.setTimeout(resolve, payload.stage === "converting" ? 5000 : 900));
      }
      setMessage(finalMessage);
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "포트폴리오 준비에 실패했습니다.");
    } finally {
      setPreparing(false);
    }
  }

  const connected = data?.connection?.status === "connected";

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
              disabled={!connected || preparing}
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

            {message && <p className="mt-4 rounded-xl bg-[#f7f7f7] p-4 text-sm">{message}</p>}
            {data?.connection?.last_error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                마지막 오류: {data.connection.last_error}
              </p>
            )}

            <div className="mt-7 flex items-center gap-2">
              <FileSearch className="text-[var(--primary)]" size={20} />
              <h3 className="font-bold">자동 선별된 최근 후보</h3>
            </div>
            {data?.candidates?.length ? (
              <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                {data.candidates.map((candidate) => (
                  <article key={candidate.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-bold">{candidate.project_name}</h4>
                      <p className="mt-1 text-xs text-[var(--muted)]">{candidate.selection_reasons.join(" · ")}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="rounded-full bg-[#fff3e9] px-3 py-1.5">적합도 {Math.round(candidate.quality_score)}점</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1.5">개인정보 검사 전</span>
                    </div>
                  </article>
                ))}
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
