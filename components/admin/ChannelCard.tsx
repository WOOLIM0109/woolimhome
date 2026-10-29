import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function ChannelCard({
  href,
  eyebrow,
  title,
  description,
  metrics,
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  metrics: { label: string; value: string }[];
}) {
  return (
    <article className="flex flex-col border border-[var(--line)] bg-white p-6 transition-colors hover:border-[#d4d4d4] hover:bg-[#fafafa]">
      <p className="eyebrow text-[11px]">{eyebrow}</p>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <p className="prose-muted mt-2 flex-1 text-[15px]">{description}</p>
      {/*
        수치는 상자 두 개로 두지 않습니다. 카드가 좁아지면 값이 두 줄로
        접혀서 지저분해졌습니다. 이름 왼쪽·값 오른쪽의 한 줄짜리 목록이면
        어느 너비에서도 접히지 않습니다.
      */}
      <dl className="mt-6 border-t border-[var(--line)]">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-2.5">
            <dt className="text-[13px] text-[var(--muted)]">{metric.label}</dt>
            <dd className="text-[15px] font-bold">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="text-link mt-6 w-full text-sm">
        관리 화면 열기 <ArrowUpRight size={16} aria-hidden />
      </Link>
    </article>
  );
}
