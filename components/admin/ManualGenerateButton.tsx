"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, XCircle } from "lucide-react";

export default function ManualGenerateButton() {
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
      const response = await fetch("/api/admin/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "design_insight", requestId }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (data.cancelled) {
        setMessage("디자인 인사이트 초안 생성을 취소했습니다.");
        return;
      }
      if (!response.ok) throw new Error(data.error || "초안을 생성하지 못했습니다.");
      setMessage("시험 초안이 생성되었습니다. 아래 작업 큐에서 확인해 주세요.");
      window.location.reload();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "초안을 생성하지 못했습니다.");
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
        body: JSON.stringify({ requestId, kind: "design_insight" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "초안 생성을 취소하지 못했습니다.");
      setMessage("디자인 인사이트 초안 생성을 취소했습니다.");
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
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold disabled:opacity-50"
        >
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Bot size={17} />}
          {loading ? "초안 생성 중…" : "디자인 인사이트 시험 초안"}
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
      {message && <p className="mt-2 max-w-sm text-sm font-bold text-[var(--primary)]">{message}</p>}
    </div>
  );
}
