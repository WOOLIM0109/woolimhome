import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { getNewsBySlug, news } from "@/data/news";
import { site } from "@/data/site";
import { breadcrumbSchema } from "@/lib/schema";
import { buildCanonical, toAbsoluteUrl, trimMetaDescription } from "@/lib/site-config";
import styles from "../editorial.module.css";

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
            { name: "인사이트", href: "/news" },
            { name: "소식", href: "/news" },
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

      <div className={styles.page}>
        <article className={styles.article}>
          <Link href="/news" className={styles.backLink}>
            <ArrowLeft size={17} aria-hidden="true" />
            소식 목록으로
          </Link>

          <header className={styles.articleHeader}>
            <p className={styles.category}>울림컴퍼니 소식</p>
            <h1>{item.title}</h1>
            <p className={styles.summary}>{item.summary}</p>
            <div className={styles.articleMeta}>
              <time dateTime={item.date}>{item.date.replaceAll("-", ".")}</time>
              <span>{item.source}</span>
            </div>
          </header>

          <div className={styles.articleBody}>
            {item.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <a
            href={`tel:${site.phone.replaceAll("-", "")}`}
            className={styles.callLink}
          >
            <span>
              <strong>지원금 받고 울림컴퍼니에 무료 컨설팅 받기</strong>
              <span>{site.phone}</span>
            </span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </a>
          <footer className={styles.articleFooter}>
            <Link href="/news" className={styles.backLink}>
              <ArrowLeft size={17} aria-hidden="true" /> 소식 목록으로
            </Link>
            <span>WOOLIM COMPANY</span>
          </footer>
        </article>
      </div>
    </>
  );
}
