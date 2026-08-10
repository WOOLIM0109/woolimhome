"use client";

import { useState } from "react";
import AdminPortal from "@/components/admin/AdminPortal";
import GeminiReviewPanel from "@/components/admin/GeminiReviewPanel";

export default function EditorialMaintenancePage() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setResult("");
    try {
      const revisions = JSON.parse(payload);
      const response = await fetch("/api/admin/content/manual-editorial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisions }),
      });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPortal
      title="원고 수동 복구·AI 검수"
      description="수정 내용은 먼저 로컬에 모으고, 호출량을 확인한 뒤 직접 승인한 경우에만 AI 검수를 실행합니다."
    >
      <GeminiReviewPanel />

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6">
        <h2 className="text-xl font-bold">AI 없이 원고 수동 적용</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
          이 저장 기능은 Gemini를 호출하지 않습니다. 서버 검증을 통과한 미발행 원고만 교체합니다.
        </p>
        <label htmlFor="manual-editorial-json" className="mt-5 block font-bold">수동 교정 JSON</label>
        <textarea
          id="manual-editorial-json"
          className="input mt-3 min-h-80 font-mono text-xs"
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          placeholder='[{"channel":"naver_design","title":"...","bodyHtml":"...","faq":[]}]'
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !payload.trim()}
          className="btn-gradient mt-4 rounded-xl px-5 py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? "서버 검증·저장 중…" : "검증 후 미발행 원고에 적용"}
        </button>
        {result && <pre className="mt-5 overflow-auto rounded-xl bg-stone-950 p-4 text-xs text-white">{result}</pre>}
      </section>
    </AdminPortal>
  );
}
