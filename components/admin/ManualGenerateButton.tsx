"use client";

import { useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";

/**
 * 예약 일정을 기다리지 않고 지금 초안을 만듭니다.
 *
 * 예약으로 만들어진 항목을 지우면 새 글을 만들 방법이 없어지는 문제가 있었습니다.
 * 컨설팅 블로그 두 형식도 여기서 바로 만들 수 있게 했습니다.
 *
 * 주제나 자료를 함께 넘길 수 있습니다. 셋 다 선택입니다.
 * 한 단어만 적어도 되고, 이미 써 둔 원고를 통째로 붙여넣어도 됩니다.
 * 아무것도 넣지 않으면 지금까지처럼 알아서 주제를 고릅니다.
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
  const [briefOpen, setBriefOpen] = useState(false);
  const [topicHint, setTopicHint] = useState("");
  const [sourceMaterial, setSourceMaterial] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
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
        body: JSON.stringify({
          channel: kind.channel,
          format: kind.format,
          requestId,
          topicHint,
          sourceMaterial,
          sourceUrls: sourceUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean),
        }),
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
  const hasBrief = Boolean(topicHint.trim() || sourceMaterial.trim() || sourceUrls.trim());

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
        <button
          type="button"
          onClick={() => setBriefOpen((current) => !current)}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 font-bold ${
            hasBrief ? "border-[#ef762f] bg-[#fff3ea] text-[#a5430b]" : "border-[var(--line)] bg-white"
          }`}
        >
          {briefOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          {hasBrief ? "주제·자료 넣음" : "주제·자료 넣기"}
        </button>
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
      {briefOpen && (
        <div className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white p-5 lg:w-[680px]">
          <p className="text-sm font-bold">무엇에 대해 쓸지 알려 주세요</p>
          <p className="prose-muted mt-1 text-sm">
            셋 다 선택입니다. 넣지 않으면 지금까지처럼 알아서 주제를 고릅니다.
            넣을수록 그 주제에 맞춰 조사하고 씁니다.
          </p>

          <label className="mt-4 block text-xs font-bold">주제 (한 단어만 적어도 됩니다)</label>
          <input
            className="input mt-1"
            placeholder="예: 모두의 창업 2기"
            value={topicHint}
            onChange={(event) => setTopicHint(event.target.value)}
          />

          <label className="mt-4 block text-xs font-bold">
            참고 자료 (써 둔 원고나 공고문을 통째로 붙여넣으세요)
          </label>
          <textarea
            className="input mt-1 text-sm"
            rows={8}
            placeholder="붙여넣은 내용은 주제와 논지를 잡는 데 씁니다. 숫자와 기한은 공식 자료로 다시 확인한 것만 본문에 들어갑니다."
            value={sourceMaterial}
            onChange={(event) => setSourceMaterial(event.target.value)}
          />

          <label className="mt-4 block text-xs font-bold">참고 링크 (한 줄에 하나)</label>
          <textarea
            className="input mt-1 text-sm"
            rows={3}
            placeholder="https://www.mss.go.kr/..."
            value={sourceUrls}
            onChange={(event) => setSourceUrls(event.target.value)}
          />
          <p className="prose-muted mt-2 text-xs">
            정부·공공기관·학교·공식 통계 주소만 읽습니다. 그 밖의 주소는 읽지 않고, 무엇을 건너뛰었는지 검토 메모에 적어 드립니다.
          </p>
        </div>
      )}
      {message && <p className="mt-2 max-w-sm text-sm font-bold text-[var(--primary)]">{message}</p>}
    </div>
  );
}
