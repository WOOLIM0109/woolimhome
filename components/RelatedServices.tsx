import Link from "next/link";
import { ArrowRight } from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import { services } from "@/data/content";

export default function RelatedServices({ currentSlug }: { currentSlug: string }) {
  const others = services.filter((s) => s.slug !== currentSlug);
  return (
    <section className="bg-[var(--surface-strong)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
        <SectionHeader eyebrow="추천" title="함께 보면 좋은 서비스" />
        <div className="mt-9 grid items-stretch gap-4 lg:grid-cols-2">
          {others.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="card card-hover h-full flex-row items-center gap-5 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Icon size={24} />
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-[#14100c]">{item.title}</p>
                  <p className="prose-muted mt-1 text-sm">{item.summary}</p>
                </div>
                <ArrowRight size={18} className="shrink-0 text-[var(--primary)]" />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
