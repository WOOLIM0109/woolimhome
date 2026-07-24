import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
    <article className="card card-hover p-6">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--primary)]">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-bold">{title}</h2>
      <p className="prose-muted mt-2 text-sm">{description}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl bg-[#fff7f1] p-3">
            <dt className="text-xs text-[var(--muted)]">{metric.label}</dt>
            <dd className="mt-1 font-bold">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-6 inline-flex items-center gap-2 font-bold text-[var(--primary)]">
        관리 화면 열기 <ArrowRight size={17} />
      </Link>
    </article>
  );
}
