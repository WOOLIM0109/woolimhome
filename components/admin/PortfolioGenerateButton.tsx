"use client";

import { useState } from "react";
import { Images, Loader2 } from "lucide-react";

export default function PortfolioGenerateButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function generate() {
    setLoading(true);
    setMessage("");
    try {
      let completed = false;
      for (let attempt = 0; attempt < 14; attempt += 1) {
        const response = await fetch("/api/admin/naver-works/prepare", { method: "POST" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "포트폴리오 준비에 실패했습니다.");
        setMessage(`${payload.message}${payload.shouldContinue ? ` · ${attempt + 1}단계 처리 중` : ""}`);
        if (payload.stage === "review") {
          completed = true;
          break;
        }
        if (!payload.shouldContinue) break;
        await new Promise((resolve) =>
          window.setTimeout(resolve, payload.stage === "converting" ? 5000 : 1000));
      }
      if (completed) {
        window.setTimeout(() => window.location.reload(), 800);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "포트폴리오 준비에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={loading}
        onClick={() => void generate()}
        className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white disabled:opacity-50"
      >
        {loading ? <Loader2 size={17} className="animate-spin" /> : <Images size={17} />}
        {loading ? "프로젝트 선별·제작 중…" : "지금 포트폴리오 초안 만들기"}
      </button>
      {message && <p className="mt-2 max-w-xl text-sm font-bold text-[var(--primary)]">{message}</p>}
    </div>
  );
}
