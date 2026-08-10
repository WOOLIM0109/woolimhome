"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";

type ReviewItem = {
  id: string;
  title: string;
  originalContent: string;
  changedContent: string;
  context: string;
};

type BudgetSummary = {
  dailyCallsUsed: number;
  dailyCallsLimit: number;
  monthlyCallsUsed: number;
  monthlyCallsLimit: number;
  dailyCostUsed: number;
  dailyCostLimit: number;
  monthlyCostUsed: number;
  monthlyCostLimit: number;
};

type PreflightResult = {
  confirmationToken: string | null;
  contentHash: string;
  promptVersion: string;
  model: string;
  contentCount: number;
  inputChars: number;
  estimatedInputTokens: number;
  estimatedMaxCostUsd: number;
  maxNetworkAttempts: number;
  cacheHit: boolean;
  enabled: boolean;
  blockedReason?: string | null;
  budget: BudgetSummary;
};

type ReviewResultItem = {
  id: string;
  status: string;
  issues?: string[];
  suggestedContent?: string;
};

type RunResult = {
  cacheHit: boolean;
  results: ReviewResultItem[];
  failedItemIds: string[];
  persistenceWarning?: string | null;
  usage?: unknown;
};

const EMPTY_ITEM: ReviewItem = {
  id: "review-1",
  title: "",
  originalContent: "",
  changedContent: "",
  context: "",
};

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function formatUsd(value: number | undefined) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value ?? 0);
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: string; message?: string; blockedReason?: string };
    throw new Error(record.error || record.message || record.blockedReason || `요청 실패 (${response.status})`);
  }
  return data;
}

export default function GeminiReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([EMPTY_ITEM]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [notice, setNotice] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const prepareLock = useRef(false);
  const runLock = useRef(false);
  const revision = useRef(0);

  const changedItems = useMemo(
    () => items.filter((item) => item.changedContent !== item.originalContent),
    [items],
  );

  const invalidateConfirmation = () => {
    revision.current += 1;
    setPreflight(null);
    setRunResult(null);
    setNotice("");
  };

  const updateItem = (id: string, key: keyof Omit<ReviewItem, "id">, value: string) => {
    invalidateConfirmation();
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (key === "originalContent") {
        const shouldSeedChanged = item.changedContent === item.originalContent || item.changedContent === "";
        return {
          ...item,
          originalContent: value,
          changedContent: shouldSeedChanged ? value : item.changedContent,
        };
      }
      return { ...item, [key]: value };
    }));
  };

  const addItem = () => {
    invalidateConfirmation();
    setItems((current) => [
      ...current,
      {
        id: `review-${Date.now()}-${current.length + 1}`,
        title: "",
        originalContent: "",
        changedContent: "",
        context: "",
      },
    ]);
  };

  const removeItem = (id: string) => {
    invalidateConfirmation();
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length > 0 ? next : [{ ...EMPTY_ITEM, id: `review-${Date.now()}` }];
    });
  };

  const prepare = async () => {
    if (prepareLock.current) return;
    if (changedItems.length === 0) {
      setNotice("원문과 달라진 내용이 없습니다. 수정본을 입력한 뒤 다시 확인해 주세요.");
      return;
    }

    prepareLock.current = true;
    const preparedRevision = revision.current;
    setPreparing(true);
    setPreflight(null);
    setRunResult(null);
    setNotice("");
    try {
      const response = await fetch("/api/admin/gemini-review/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: changedItems }),
      });
      const data = await readJson(response) as PreflightResult;
      if (preparedRevision !== revision.current) {
        setNotice("확인 중 내용이 바뀌었습니다. 현재 내용으로 다시 확인해 주세요.");
        return;
      }
      setPreflight(data);
      if (data.blockedReason) setNotice(data.blockedReason);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "호출 내용을 확인하지 못했습니다.");
    } finally {
      prepareLock.current = false;
      setPreparing(false);
    }
  };

  const runReview = async () => {
    if (!preflight?.confirmationToken || runLock.current) return;

    runLock.current = true;
    setRunning(true);
    setRunResult(null);
    setNotice("");
    try {
      const response = await fetch("/api/admin/gemini-review/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: changedItems,
          confirmationToken: preflight.confirmationToken,
        }),
      });
      const data = await readJson(response) as RunResult;
      setRunResult(data);

      const failedIds = new Set(data.failedItemIds ?? []);
      if (failedIds.size > 0) {
        setItems((current) => current.filter((item) => failedIds.has(item.id)));
        setNotice(`${failedIds.size}건만 실패했습니다. 아래에는 재검수할 실패 항목만 남겼습니다.`);
        setPreflight(null);
      } else {
        setNotice(data.persistenceWarning || (data.cacheHit
          ? "저장된 검수 결과를 불러왔습니다. Gemini API는 호출하지 않았습니다."
          : "AI 검수가 완료되었습니다."));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 검수를 완료하지 못했습니다.");
      setPreflight(null);
    } finally {
      runLock.current = false;
      setRunning(false);
    }
  };

  const canRun = Boolean(
    preflight?.confirmationToken
      && !preflight.blockedReason
      && (preflight.enabled || preflight.cacheHit)
      && !runResult,
  );

  return (
    <section className="mt-8 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" />
        <div>
          <h2 className="text-xl font-bold">Gemini API 비용 보호 검수</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            입력과 수정 내용은 이 화면의 로컬 상태에만 쌓입니다. 먼저 호출량을 확인한 뒤
            <strong className="text-stone-800"> AI 검수 실행</strong>을 직접 눌러야만 검수를 요청합니다.
            서버는 원문 전체가 아니라 실제로 달라진 조각과 짧은 주변 문맥만 비식별화해 전송합니다.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {items.map((item, index) => (
          <article key={item.id} className="rounded-xl border border-[var(--line)] bg-[#fffaf7] p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold">검수 항목 {index + 1}</h3>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                disabled={running}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
              >
                <Trash2 size={15} /> 삭제
              </button>
            </div>

            <label className="mt-4 block text-sm font-bold" htmlFor={`${item.id}-title`}>제목 또는 구분명</label>
            <input
              id={`${item.id}-title`}
              className="input mt-2"
              value={item.title}
              onChange={(event) => updateItem(item.id, "title", event.target.value)}
              disabled={running}
              placeholder="예: 생활폐기물 입찰제안서 본문"
            />

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div>
                <label className="block text-sm font-bold" htmlFor={`${item.id}-original`}>원문</label>
                <textarea
                  id={`${item.id}-original`}
                  className="input mt-2 min-h-56 text-sm leading-6"
                  value={item.originalContent}
                  onChange={(event) => updateItem(item.id, "originalContent", event.target.value)}
                  disabled={running}
                  placeholder="수정 전 내용을 붙여 넣으세요. 처음 입력하면 수정본에도 동일하게 채워집니다."
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-bold" htmlFor={`${item.id}-changed`}>수정본</label>
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, "changedContent", item.originalContent)}
                    disabled={running}
                    className="inline-flex items-center gap-1 text-xs font-bold text-[var(--muted)] hover:text-stone-900"
                  >
                    <RotateCcw size={13} /> 원문으로 되돌리기
                  </button>
                </div>
                <textarea
                  id={`${item.id}-changed`}
                  className="input mt-2 min-h-56 text-sm leading-6"
                  value={item.changedContent}
                  onChange={(event) => updateItem(item.id, "changedContent", event.target.value)}
                  disabled={running}
                  placeholder="원문을 바탕으로 최종 수정본을 작성하세요. 서버가 실제 변경 조각만 추출합니다."
                />
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold" htmlFor={`${item.id}-context`}>꼭 필요한 문맥 (선택)</label>
            <textarea
              id={`${item.id}-context`}
              className="input mt-2 min-h-24 text-sm leading-6"
              value={item.context}
              onChange={(event) => updateItem(item.id, "context", event.target.value)}
              disabled={running}
              placeholder="전체 원고나 대화 기록 대신 검수에 꼭 필요한 조건만 입력하세요."
            />
          </article>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addItem}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold"
        >
          <Plus size={17} /> 검수 항목 추가
        </button>
        <span className="text-sm text-[var(--muted)]">변경 감지: {changedItems.length}건</span>
      </div>

      <div className="mt-6 border-t border-[var(--line)] pt-6">
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={preparing || running || changedItems.length === 0}
          className="rounded-xl border border-emerald-700 bg-white px-5 py-3 font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preparing ? "확인 중…" : "호출 내용 확인"}
        </button>

        {preflight && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-bold">호출 전 확인</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${preflight.enabled ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                Gemini {preflight.enabled ? "사용 가능" : "비활성"}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-[var(--muted)]">대상 콘텐츠</dt><dd className="mt-1 font-bold">{formatNumber(preflight.contentCount)}건</dd></div>
              <div><dt className="text-[var(--muted)]">입력 글자 수</dt><dd className="mt-1 font-bold">{formatNumber(preflight.inputChars)}자</dd></div>
              <div><dt className="text-[var(--muted)]">예상 입력 토큰</dt><dd className="mt-1 font-bold">{formatNumber(preflight.estimatedInputTokens)}</dd></div>
              <div><dt className="text-[var(--muted)]">최대 예상 비용</dt><dd className="mt-1 font-bold">{formatUsd(preflight.estimatedMaxCostUsd)}</dd></div>
              <div><dt className="text-[var(--muted)]">최대 네트워크 시도</dt><dd className="mt-1 font-bold">{formatNumber(preflight.maxNetworkAttempts)}회 (최초 1 + 조건부 재시도 1)</dd></div>
              <div><dt className="text-[var(--muted)]">모델</dt><dd className="mt-1 break-all font-bold">{preflight.model}</dd></div>
              <div><dt className="text-[var(--muted)]">프롬프트 버전</dt><dd className="mt-1 break-all font-bold">{preflight.promptVersion}</dd></div>
              <div><dt className="text-[var(--muted)]">캐시</dt><dd className="mt-1 font-bold">{preflight.cacheHit ? "적중 · API 호출 없음" : "미적중"}</dd></div>
              <div><dt className="text-[var(--muted)]">콘텐츠 해시</dt><dd className="mt-1 truncate font-mono text-xs" title={preflight.contentHash}>{preflight.contentHash}</dd></div>
            </dl>

            <div className="mt-4 grid gap-2 rounded-lg bg-white p-4 text-sm sm:grid-cols-2">
              <p>일일 요청: <strong>{formatNumber(preflight.budget.dailyCallsUsed)} / {formatNumber(preflight.budget.dailyCallsLimit)}</strong></p>
              <p>월간 요청: <strong>{formatNumber(preflight.budget.monthlyCallsUsed)} / {formatNumber(preflight.budget.monthlyCallsLimit)}</strong></p>
              <p>일일 비용: <strong>{formatUsd(preflight.budget.dailyCostUsed)} / {formatUsd(preflight.budget.dailyCostLimit)}</strong></p>
              <p>월간 비용: <strong>{formatUsd(preflight.budget.monthlyCostUsed)} / {formatUsd(preflight.budget.monthlyCostLimit)}</strong></p>
            </div>

            {preflight.blockedReason && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" /> {preflight.blockedReason}
              </p>
            )}

            <div className="mt-5">
              <p className="mb-3 text-sm leading-6 text-stone-700">
                위 대상 수와 예상 입력량을 확인했습니다. 아래 버튼을 누르는 경우에만 검수를 실행합니다.
              </p>
              <button
                type="button"
                onClick={() => void runReview()}
                disabled={!canRun || running || preparing}
                className="btn-gradient rounded-xl px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? "AI 검수 중…" : "AI 검수 실행"}
              </button>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" /> {notice}
        </p>
      )}

      {runResult && (
        <div className="mt-6 rounded-xl border border-[var(--line)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-bold"><CheckCircle2 size={18} className="text-emerald-700" /> 검수 결과</h3>
            <span className="text-xs font-bold text-[var(--muted)]">{runResult.cacheHit ? "캐시 결과" : "신규 검수 결과"}</span>
          </div>
          <div className="mt-4 space-y-4">
            {runResult.results.map((result) => (
              <article key={result.id} className="rounded-lg bg-[#fffaf7] p-4">
                <p className="font-bold">{items.find((item) => item.id === result.id)?.title || result.id} · {result.status}</p>
                {result.issues && result.issues.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-stone-700">
                    {result.issues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                )}
                {result.suggestedContent && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold">제안 수정본</p>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(result.suggestedContent ?? "")}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[var(--muted)] hover:text-stone-900"
                      >
                        <Copy size={13} /> 복사
                      </button>
                    </div>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-950 p-4 text-xs leading-6 text-white">{result.suggestedContent}</pre>
                  </div>
                )}
              </article>
            ))}
          </div>
          {runResult.usage !== undefined && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-bold">사용량 기록 보기</summary>
              <pre className="mt-2 overflow-auto rounded-lg bg-stone-100 p-3 text-xs">{JSON.stringify(runResult.usage, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
