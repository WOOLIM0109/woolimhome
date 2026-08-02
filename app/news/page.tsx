import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import { getNewsHref, news } from "@/data/news";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "소식/언론보도",
  description: "울림컴퍼니의 언론보도, 수상 소식, 주요 공지를 확인할 수 있습니다.",
  alternates: { canonical: buildCanonical("/news") },
};

export default function NewsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "알림마당", href: "/news" }, { name: "소식/언론보도", href: "/news" }]),
          itemListSchema("울림컴퍼니 소식/언론보도", news.map((item) => ({ title: item.title, description: item.summary, href: getNewsHref(item) }))),
        ]}
      />
      <PageHero eyebrow="알림마당" title="소식/언론보도" description="울림컴퍼니의 수상, 언론보도, 주요 활동을 카드 형태로 정리합니다." />
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-16 lg:px-8 lg:py-20">
          {news.map((item) => (
            <article key={item.title} className="card p-7 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-bold text-[var(--accent)]">{item.date} · {item.source}</p>
                <h2 className="mt-3 text-2xl font-bold text-[#14100c]">{item.title}</h2>
                <p className="prose-muted mt-4 max-w-3xl text-sm">{item.summary}</p>
              </div>
              {item.slug ? (
                <Link href={`/news/${item.slug}`} className="mt-5 inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-5 text-sm font-bold transition hover:border-[var(--accent)] hover:text-[var(--accent)] lg:mt-0">
                  소식 자세히 보기 <ArrowRight size={16} />
                </Link>
              ) : (
                <a href={item.href} target="_blank" rel="noreferrer" className="mt-5 inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-5 text-sm font-bold transition hover:border-[var(--accent)] hover:text-[var(--accent)] lg:mt-0">
                  기사 보기 <ExternalLink size={16} />
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
      <ContactBand />
    </>
  );
}
