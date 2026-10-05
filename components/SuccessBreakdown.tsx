import type { getSuccessMetrics } from "@/data/success-metrics";

export default function SuccessBreakdown({ metrics }: { metrics: Awaited<ReturnType<typeof getSuccessMetrics>> }) {
  return (
    <div className="mx-auto max-w-[1504px] px-5 pb-8 sm:px-12" aria-label="누적 실적 세부 내역">
      <p className="mb-4 text-sm text-[var(--muted)]">{metrics.period} 확정 실적 · 선정·낙찰·투자 누적 {metrics.total} 원</p>
      <dl className="grid gap-4 sm:grid-cols-3">
        {metrics.breakdown.map((item) => (
          <div key={item.key} className="border-t border-[var(--line)] pt-3">
            <dt className="text-sm text-[var(--muted)]">{item.label} · {item.count}건</dt>
            <dd className="mt-1 text-lg font-semibold">{item.amount} 원</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-[var(--muted)]">지원사업 선정액, 용역 낙찰액, 투자유치액은 성격이 다른 실적으로 구분해 안내합니다.</p>
    </div>
  );
}
