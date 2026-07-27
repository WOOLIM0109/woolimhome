"use client";

import { useRef, useState } from "react";
import { Images, Loader2, XCircle } from "lucide-react";

export default function PortfolioGenerateButton() {
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const requestIdRef = useRef("");
  const controllerRef = useRef<AbortController | null>(null);

  async function generate() {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    requestIdRef.current = requestId;
    controllerRef.current = controller;
    setLoading(true);
    setMessage("");

    try {
      let completed = false;
      for (let attempt = 0; attempt < 14; attempt += 1) {
        const response = await fetch("/api/admin/naver-works/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (payload.cancelled || payload.stage === "cancelled") {
          setMessage("포트폴리오 초안 생성을 취소했습니다.");
          break;
        }
        if (!response.ok) {
          throw new Error(payload.error || "포트폴리오 초안을 준비하지 못했습니다.");
        }
        setMessage(
          `${payload.message}${payload.shouldContinue ? ` · ${attempt + 1}단계 처리 중` : ""}`,
        );
        if (payload.stage === "review") {
          completed = true;
          break;
        }
        if (!payload.shouldContinue) break;
        await new Promise((resolve) =>
          window.setTimeout(resolve, payload.stage === "converting" ? 5000 : 1000));
      }
      if (completed) window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(
        error instanceof Error ? error.message : "포트폴리오 초안을 준비하지 못했습니다.",
      );
    } finally {
      if (requestIdRef.current === requestId) {
        requestIdRef.current = "";
        controllerRef.current = null;
      }
      setLoading(false);
    }
  }

  async function cancel() {
    const requestId = requestIdRef.current;
    if (!requestId || cancelling) return;

    controllerRef.current?.abort();
    setLoading(false);
    setCancelling(true);
    setMessage("초안 생성을 취소하고 임시 작업을 정리하고 있습니다.");
    try {
      const response = await fetch("/api/admin/content/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, kind: "portfolio" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "초안 생성을 취소하지 못했습니다.");
      setMessage("포트폴리오 초안 생성을 취소했습니다. 원본 프로젝트 파일은 그대로 보존됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초안 생성을 취소하지 못했습니다.");
    } finally {
      requestIdRef.current = "";
      controllerRef.current = null;
      setCancelling(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading || cancelling}
          onClick={() => void generate()}
          className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white disabled:opacity-50"
        >
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Images size={17} />}
          {loading ? "프로젝트 선별·제작 중…" : "지금 포트폴리오 초안 만들기"}
        </button>
        {(loading || cancelling) && (
          <button
            type="button"
            disabled={cancelling}
            onClick={() => void cancel()}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? <Loader2 size={17} className="animate-spin" /> : <XCircle size={17} />}
            {cancelling ? "취소 처리 중…" : "생성 즉시 취소"}
          </button>
        )}
      </div>
      {message && <p className="mt-2 max-w-xl text-sm font-bold text-[var(--primary)]">{message}</p>}
    </div>
  );
}
