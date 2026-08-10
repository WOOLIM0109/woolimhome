import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
      <article className="bg-white">
        <header className="border-b border-[var(--line)] bg-[var(--surface-strong)]">
          <div className="mx-auto max-w-4xl px-5 py-16 lg:px-8 lg:py-24">
            <p className="eyebrow">{post.category || "Woolim Column"}</p>
            <h1 className="mt-5 text-4xl font-bold leading-tight text-[#14100c] lg:text-5xl">{post.title}</h1>
            {post.excerpt && <p className="prose-muted mt-6 text-lg">{post.excerpt}</p>}
            <p className="mt-6 text-sm text-[var(--muted)]">
              {new Date(post.published_at || post.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · 울림컴퍼니
            </p>
          </div>
        </header>
        <div className="mx-auto max-w-4xl px-5 py-14 lg:px-8 lg:py-20">
          <div
            className="column-body"
            dangerouslySetInnerHTML={{ __html: safeArticleHtml(post.content) }}
          />

        </div>
      </article>

      {related.length > 0 && (
        <section className="bg-[var(--surface-strong)]">
          <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
            <h2 className="text-2xl font-bold text-[#14100c]">함께 읽으면 좋은 칼럼</h2>
            <div className="mt-7 grid gap-4 lg:grid-cols-4">
              {related.map((item) => (
                <Link key={item.id} href={`/columns/${item.slug}`} className="card card-hover p-6">
                  <p className="eyebrow">{item.category || "Column"}</p>
                  <h3 className="mt-3 font-bold leading-6">{item.title}</h3>
                  <p className="prose-muted mt-3 text-sm">{item.excerpt}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
      <ContactBand />
    </>
  );
}
