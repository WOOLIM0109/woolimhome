"use client";

import { useState } from "react";
import { Bot } from "lucide-react";

export default function ManualGenerateButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function generate() {
    setLoading(true); setMessage("");
    const response = await fetch("/api/admin/content/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "design_insight" }) });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setMessage(data.error || "초안을 생성하지 못했습니다.");
    setMessage("시험 초안이 생성되었습니다. 아래 작업 큐에서 확인해 주세요.");
    window.location.reload();
  }
  return <div><button type="button" disabled={loading} onClick={() => void generate()} className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white disabled:opacity-50"><Bot size={17} /> {loading ? "초안 생성 중…" : "지금 시험 초안 만들기"}</button>{message && <p className="mt-2 max-w-sm text-sm font-bold text-[var(--primary)]">{message}</p>}</div>;
}
