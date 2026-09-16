"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * 지금 걸려 있는 상한과 이번 달 사용량.
 *
 * 상한 값은 Vercel 환경변수에 들어 있는데, Sensitive 로 저장하면 만든 뒤에는
 * 다시 볼 수 없습니다. 화면에도 없어서 초안 생성이 막혔을 때 무엇이 얼마나
 * 남았는지 알 길이 없었습니다. 이 화면을 여는 것만으로는 요금이 들지 않습니다.
 */

type Budget = {
  enabled: boolean;
  reason: string | null;
  usage: {
    dailyCallsUsed: number;
    monthlyCallsUsed: number;
    dailyCostUsed: number;
    monthlyCostUsed: number;
  };
  limits: {
    dailyCalls: number;
    monthlyCalls: number;
    dailyCostUsd: number;
    monthlyCostUsd: number;
  };
  pricing: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
  };
};

/** 환경변수 이름을 함께 적어 둡니다. 무엇을 고쳐야 하는지 화면에서 바로 알 수 있어야 합니다. */
const ROWS = [
  { key: "dailyCalls", label: "오늘 호출", unit: "회", env: "GEMINI_AUTOMATION_DAILY_CALL_LIMIT" },
  { key: "monthlyCalls", label: "이번 달 호출", unit: "회", env: "GEMINI_AUTOMATION_MONTHLY_CALL_LIMIT" },
  { key: "dailyCostUsd", label: "오늘 비용", unit: "$", env: "GEMINI_AUTOMATION_DAILY_COST_LIMIT_USD" },
  { key: "monthlyCostUsd", label: "이번 달 비용", unit: "$", env: "GEMINI_AUTOMATION_MONTHLY_COST_LIMIT_USD" },
] as const;

function usedOf(budget: Budget, key: (typeof ROWS)[number]["key"]) {
  if (key === "dailyCalls") return budget.usage.dailyCallsUsed;
  if (key === "monthlyCalls") return budget.usage.monthlyCallsUsed;
  if (key === "dailyCostUsd") return budget.usage.dailyCostUsed;
  return budget.usage.monthlyCostUsed;
}

function amount(value: number, unit: string) {
  if (unit !== "$") return `${value.toLocaleString("ko-KR")}회`;
  return `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
}

export default function GeminiBudgetPanel() {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/gemini-budget", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "예산 현황을 불러오지 못했습니다.");
      setBudget(data);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예산 현황을 불러오지 못했습니다.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // 그리는 중에 곧바로 상태를 바꾸지 않고 한 박자 뒤로 미룹니다.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">지금 걸려 있는 상한</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            초안 자동 생성이 쓰는 예산입니다. 이 화면을 여는 것만으로는 요금이 들지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-bold"
        >
          <RefreshCw size={16} /> 새로고침
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="mt-4 text-sm">불러오는 중입니다.</p>}

      {!loading && budget && (
        <>
          {!budget.enabled && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              {budget.reason || "Gemini 호출이 잠겨 있습니다."}
            </p>
          )}

          <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--line)]">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-bold">항목</th>
                  <th className="px-4 py-3 text-right font-bold">사용</th>
                  <th className="px-4 py-3 text-right font-bold">상한</th>
                  <th className="px-4 py-3 text-right font-bold">남음</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const used = usedOf(budget, row.key);
                  const cap = budget.limits[row.key];
                  const left = Math.max(0, cap - used);
                  // 남은 것이 한 편도 안 될 때 눈에 띄어야 합니다.
                  // 초안 한 편이 6회를 미리 잡으므로 그 아래는 사실상 막힌 상태입니다.
                  const tight = row.unit === "$" ? left <= cap * 0.1 : left < 6;
                  return (
                    <tr key={row.key} className="border-b border-[var(--line)] last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="font-bold">{row.label}</span>
                        <span className="mt-0.5 block font-mono text-[11px] text-[var(--muted)]">{row.env}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{amount(used, row.unit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{amount(cap, row.unit)}</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${tight ? "text-red-700" : "text-emerald-700"}`}>
                        {amount(left, row.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            상한을 바꾸려면 Vercel 환경변수에서 위 이름의 값을 고치고 다시 배포하면 됩니다.
            값을 넣지 않으면 코드에 정해 둔 기본값이 쓰입니다.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            적힌 금액은 실제 청구액이 아닙니다. 호출 한 번을 입력 2만 토큰, 출력 6천 토큰으로 잡고
            100만 토큰당 입력 ${budget.pricing.inputUsdPerMillionTokens},
            출력 ${budget.pricing.outputUsdPerMillionTokens}로 계산한 값입니다.
            실제 단가는 이보다 낮으므로 넉넉히 부풀린 값으로 읽어 주세요.
          </p>
        </>
      )}
    </section>
  );
}
