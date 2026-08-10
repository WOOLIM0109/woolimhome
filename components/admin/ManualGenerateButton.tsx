"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, XCircle } from "lucide-react";

/**
 * 예약 일정을 기다리지 않고 지금 초안을 만듭니다.
 *
 * 예약으로 만들어진 항목을 지우면 새 글을 만들 방법이 없어지는 문제가 있었습니다.
 * 컨설팅 블로그 두 형식도 여기서 바로 만들 수 있게 했습니다.
 */
type DraftKind = {
  id: string;
  label: string;
  channel: "naver_design" | "naver_consulting";
  format: "design_insight" | "informational" | "authority";
  cancelKind: "design_insight" | "consulting";
};

const DRAFT_KINDS: DraftKind[] = [
  {
    id: "consulting-informational",
    label: "컨설팅 정보형 초안",
    channel: "naver_consulting",
    format: "informational",
    cancelKind: "consulting",
  },
  {
    id: "consulting-authority",
    label: "컨설팅 울림 콘텐츠형 초안",
    channel: "naver_consulting",
    format: "authority",
    cancelKind: "consulting",
  },
  {
    id: "design-insight",
    label: "디자인 인사이트 시험 초안",
    channel: "naver_design",
    format: "design_insight",
    cancelKind: "design_insight",
  },
];

export default function ManualGenerateButton({
  channel = "naver_design",
}: { channel?: "naver_design" | "naver_consulting" } = {}) {
  const kinds = DRAFT_KINDS.filter((kind) => kind.channel === channel);
  const [loadingId, setLoadingId] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState("");
  const requestIdRef = useRef("");
  const cancelKindRef = useRef<DraftKind["cancelKind"]>("design_insight");
  const controllerRef = useRef<AbortController | null>(null);

  async function generate(kind: DraftKind) {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    requestIdRef.current = requestId;
    cancelKindRef.current = kind.cancelKind;
    controllerRef.current = controller;
    setLoadingId(kind.id);
    setMessage("");

    try {
      const response = await fetch("/api/admin/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: kind.channel, format: kind.format, requestId }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (data.cancelled) {
        setMessage(`${kind.label} 생성을 취소했습니다.`);
        return;
      }
      if (!response.ok) throw new Error(data.error || "초안을 생성하지 못했습니다.");
      setMessage("초안이 생성되었습니다. 아래 작업 큐에서 확인해 주세요.");
      window.location.reload();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "초안을 생성하지 못했습니다.");
    } finally {
      if (requestIdRef.current === requestId) {
        requestIdRef.current = "";
        controllerRef.current = null;
      }
      setLoadingId("");
    }
  }

  async function cancel() {
    const requestId = requestIdRef.current;
    if (!requestId || cancelling) return;

    controllerRef.current?.abort();
    setLoadingId("");
    setCancelling(true);
    setMessage("초안 생성을 취소하고 임시 작업을 정리하고 있습니다.");
    try {
      const response = await fetch("/api/admin/content/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, kind: cancelKindRef.current }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "초안 생성을 취소하지 못했습니다.");
      setMessage("초안 생성을 취소했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초안 생성을 취소하지 못했습니다.");
    } finally {
      requestIdRef.current = "";
      controllerRef.current = null;
      setCancelling(false);
    }
  }

  const busy = Boolean(loadingId) || cancelling;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {kinds.map((kind) => (
          <button
            key={kind.id}
            type="button"
            disabled={busy}
            onClick={() => void generate(kind)}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold disabled:opacity-50"
          >
            {loadingId === kind.id ? <Loader2 size={17} className="animate-spin" /> : <Bot size={17} />}
            {loadingId === kind.id ? "초안 생성 중…" : kind.label}
          </button>
        ))}
        {busy && (
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
