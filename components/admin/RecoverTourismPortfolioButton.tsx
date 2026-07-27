"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

export default function RecoverTourismPortfolioButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function recover() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/content/recover-tourism", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "복구하지 못했습니다.");
      window.location.reload();
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "복구하지 못했습니다.");
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void recover()}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-bold text-amber-950 disabled:opacity-60"
      >
        {loading ? <Loader2 className="animate-spin" size={17} /> : <RotateCcw size={17} />}
        관광 포트폴리오 복구
      </button>
      {error && <small className="text-red-700">{error}</small>}
    </span>
  );
}
