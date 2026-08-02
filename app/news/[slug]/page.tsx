import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Phone } from "lucide-react";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { getNewsBySlug, news } from "@/data/news";
import { site } from "@/data/site";
import { breadcrumbSchema } from "@/lib/schema";
import { buildCanonical, toAbsoluteUrl, trimMetaDescription } from "@/lib/site-config";

type NewsDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return news.filter((item) => item.slug).map((item) => ({ slug: item.slug! }));
}

export async function generateMetadata({ params }: NewsDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const item = getNewsBySlug(slug);
  if (!item) return {};

  return {
    title: item.title,
    description: trimMetaDescription(item.summary),
    alternates: { canonical: buildCanonical(`/news/${slug}`) },
  };
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { slug } = await params;
  const item = getNewsBySlug(slug);
  if (!item?.body) notFound();

  const canonical = toAbsoluteUrl(`/news/${slug}`);

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "소식/언론보도", href: "/news" },
            { name: item.title, href: `/news/${slug}` },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: item.title,
            description: item.summary,
            datePublished: item.date,
            dateModified: item.date,
            mainEntityOfPage: canonical,
            author: { "@id": `${toAbsoluteUrl("/")}#organization` },
            publisher: { "@id": `${toAbsoluteUrl("/")}#organization` },
          },
        ]}
      />

      <main className="bg-[#fbf8f5]">
        <article className="mx-auto max-w-4xl px-5 py-16 lg:px-8 lg:py-24">
          <Link href="/news" className="inline-flex items-center gap-2 text-sm font-bold text-[#725848] transition hover:text-[var(--accent)]">
            <ArrowLeft size={17} />
            소식 목록으로
          </Link>

          <header className="mt-9 border-b border-[var(--line)] pb-9">
            <p className="text-sm font-bold text-[var(--accent)]">{item.date} · {item.source}</p>
            <h1 className="mt-4 text-3xl font-bold leading-tight text-[#14100c] lg:text-5xl">{item.title}</h1>
            <p className="mt-6 text-base leading-8 text-[#725848] lg:text-lg">{item.summary}</p>
          </header>

          <div className="mt-10 space-y-7 text-[16px] leading-8 text-[#3f342d] lg:text-[17px]">
            {item.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <a
            href={`tel:${site.phone.replaceAll("-", "")}`}
            className="mt-12 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[var(--accent)] px-5 py-4 text-center text-base font-bold text-white shadow-[0_16px_40px_rgba(235,104,38,0.24)] transition hover:-translate-y-0.5 hover:brightness-105 lg:text-lg"
          >
            <Phone size={21} />
            <span>지원금 받고 울림컴퍼니에 무료 컨설팅 받기 : 010 9522 0350</span>
          </a>
        </article>
      </main>
    </>
  );
}
