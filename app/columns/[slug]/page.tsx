import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import { buildCanonical } from "@/lib/site-config";
import {
  getPublishedColumn,
  getPublishedColumns,
  metadataArray,
  safeArticleHtml,
} from "@/lib/columns/data";
import type { ColumnFaq, ColumnSource } from "@/lib/columns/types";
import styles from "../../news/editorial.module.css";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedColumn(slug);
  if (!post) return { title: "칼럼을 찾을 수 없습니다" };

  return {
    title: post.title,
    description: post.excerpt || undefined,
    keywords: post.tags,
    alternates: { canonical: buildCanonical(`/columns/${slug}`) },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt || "",
      publishedTime: post.published_at || post.created_at,
      authors: ["울림컴퍼니"],
      tags: post.tags,
    },
  };
}

export default async function ColumnDetailPage({ params }: Props) {
  const { slug } = await params;
  const [post, allPosts] = await Promise.all([
    getPublishedColumn(slug),
    getPublishedColumns(),
  ]);
  if (!post) notFound();

  const faqs = metadataArray<ColumnFaq>(post, "faqs");
  const sources = metadataArray<ColumnSource>(post, "sources");
  const related = allPosts
    .filter((candidate) => candidate.id !== post.id)
    .map((candidate) => ({
      post: candidate,
      score: candidate.tags.filter((tag) => post.tags.includes(tag)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ post: candidate }) => candidate);
  const canonical = buildCanonical(`/columns/${slug}`);
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.published_at || post.created_at,
    dateModified: post.updated_at,
    author: { "@type": "Organization", name: "울림컴퍼니" },
    publisher: { "@type": "Organization", name: "울림컴퍼니" },
    mainEntityOfPage: canonical,
    citation: sources.map((source) => source.url),
  };
  const faqSchema = faqs.length ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  } : null;

  return (
    <>
      <JsonLd data={faqSchema ? [articleSchema, faqSchema] : articleSchema} />
      <div className={styles.page}>
        <article className={styles.article}>
          <Link href="/columns" className={styles.backLink}>
            <ArrowLeft size={17} aria-hidden="true" /> 칼럼 목록으로
          </Link>
          <header className={styles.articleHeader}>
            <p className={styles.category}>{post.category || "Woolim Column"}</p>
            <h1>{post.title}</h1>
            {post.excerpt && <p className={styles.summary}>{post.excerpt}</p>}
            <div className={styles.articleMeta}>
              <time dateTime={post.published_at || post.created_at}>
                {new Date(post.published_at || post.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
              </time>
              <span>울림컴퍼니</span>
            </div>
          </header>
          <div
            className={`column-body ${styles.articleBody}`}
            dangerouslySetInnerHTML={{ __html: safeArticleHtml(post.content) }}
          />
          <footer className={styles.articleFooter}>
            <Link href="/columns" className={styles.backLink}>
              <ArrowLeft size={17} aria-hidden="true" /> 칼럼 목록으로
            </Link>
            <span>WOOLIM COMPANY</span>
          </footer>
        </article>

        {related.length > 0 && (
          <section className={styles.related} aria-labelledby="related-columns-title">
            <div className={styles.shell}>
              <div className={styles.relatedHeading}>
                <h2 id="related-columns-title">함께 읽으면 좋은 칼럼</h2>
                <Link href="/columns" className={styles.rowLink}>
                  전체 보기 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <div className={styles.relatedList}>
                {related.map((item) => (
                  <Link key={item.id} href={`/columns/${item.slug}`} className={styles.relatedLink}>
                    <p className={styles.category}>{item.category || "Column"}</p>
                    <h3>{item.title}</h3>
                    <p>{item.excerpt}</p>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
      <ContactBand />
    </>
  );
}
