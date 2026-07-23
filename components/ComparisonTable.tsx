import { Check, X } from "lucide-react";
import { comparison } from "@/data/content";

export default function ComparisonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
      {/* 헤더 */}
      <div className="grid grid-cols-[0.7fr_1fr_1.1fr] border-b border-[var(--line)] bg-[var(--surface-strong)] text-sm font-bold">
        <div className="px-4 py-4 text-[var(--muted)] sm:px-6">구분</div>
        <div className="px-4 py-4 text-[var(--muted)] sm:px-6">일반 타사</div>
        <div className="bg-[var(--primary)] px-4 py-4 text-white sm:px-6">울림컴퍼니</div>
      </div>
      {comparison.map((row, index) => (
        <div
          key={row.axis}
          className={`grid grid-cols-[0.7fr_1fr_1.1fr] items-stretch text-sm ${index % 2 ? "bg-[#fffaf6]" : "bg-white"}`}
        >
          <div className="flex items-center px-4 py-5 font-bold text-[#2d241d] sm:px-6">{row.axis}</div>
          <div className="flex items-start gap-2 px-4 py-5 text-[var(--muted)] sm:px-6">
            <X size={16} className="mt-0.5 shrink-0 text-[#b9a99c]" />
            <span className="leading-6">{row.others}</span>
          </div>
          <div className="flex items-start gap-2 bg-[rgba(235,104,38,0.05)] px-4 py-5 font-semibold text-[#2d241d] sm:px-6">
            <Check size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
            <span className="leading-6">{row.woolim}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
