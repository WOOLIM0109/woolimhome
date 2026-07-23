import Link from "next/link";
import { ArrowRight } from "lucide-react";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export default function PageHero({ eyebrow, title, description, ctaHref, ctaLabel }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--line)] bg-[linear-gradient(135deg,#fff7f0_0%,#fdf0e7_55%,#f7e9df_100%)]">
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="absolute right-[-8rem] top-[-6rem] h-72 w-72 rounded-full bg-[rgba(235,104,38,0.14)] blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
        <span className="eyebrow">{eyebrow}</span>
        <div className="mt-5 grid gap-7 lg:grid-cols-[1fr_0.72fr] lg:items-end">
          <h1 className="section-title max-w-3xl text-4xl leading-[1.12] text-[#14100c] lg:text-[3.4rem]">
            {title}
          </h1>
          <div>
            <p className="text-lg leading-8 text-[var(--muted)]">{description}</p>
            {ctaHref && ctaLabel && (
              <Link
                href={ctaHref}
                className="btn-gradient mt-6 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-bold text-white"
              >
                {ctaLabel}
                <ArrowRight size={17} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
