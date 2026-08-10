"use client";

import { useState } from "react";
import AdminPortal from "@/components/admin/AdminPortal";

export default function EditorialMaintenancePage() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);

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

  async function diagnoseGemini() {
    setDiagnosing(true);
    setResult("");
    try {
      const response = await fetch("/api/admin/gemini-diagnostic", { method: "POST" });
      const data = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "오류 원문을 불러오지 못했습니다.");
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <AdminPortal
      title="원고 수동 복구"
      description="AI 할당량 제한 때도 숫자·이미지·링크를 잠근 상태로 미발행 원고만 안전하게 교정합니다."
    >
      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6">
        <label htmlFor="manual-editorial-json" className="font-bold">수동 교정 JSON</label>
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
        <button
          type="button"
          onClick={() => void diagnoseGemini()}
          disabled={diagnosing}
          className="ml-3 mt-4 rounded-xl border border-red-300 bg-red-50 px-5 py-3 font-bold text-red-800 disabled:opacity-50"
        >
          {diagnosing ? "Google 원문 오류 재현 중…" : "실패 2건 Google 원문 오류 재현"}
        </button>
        {result && <pre className="mt-5 overflow-auto rounded-xl bg-stone-950 p-4 text-xs text-white">{result}</pre>}
      </section>
    </AdminPortal>
  );
}
