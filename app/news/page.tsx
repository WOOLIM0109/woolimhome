import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import { getNewsHref, news } from "@/data/news";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";
import styles from "./editorial.module.css";

export const metadata: Metadata = {
  title: "소식",
  description: "울림컴퍼니의 언론보도, 수상 소식, 주요 공지를 확인할 수 있습니다.",
  alternates: { canonical: buildCanonical("/news") },
};

export default function NewsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "인사이트", href: "/news" }, { name: "소식", href: "/news" }]),
          itemListSchema("울림컴퍼니 소식", news.map((item) => ({ title: item.title, description: item.summary, href: getNewsHref(item) }))),
        ]}
      />
      <PageHero eyebrow="인사이트" title="소식" description="울림컴퍼니의 수상, 언론보도와 주요 활동을 전합니다." />
      <section className={styles.page} aria-label="울림컴퍼니 소식">
        <div className={styles.shell}>
          <nav className={styles.tabs} aria-label="인사이트 메뉴">
            <Link href="/news" aria-current="page">소식</Link>
            <Link href="/columns">칼럼</Link>
          </nav>
          <div className={styles.list}>
            <div className={styles.listHeading}>
              <h2>울림의 새로운 소식</h2>
              <span>전체 {news.length}건</span>
            </div>
            {news.map((item) => (
              <article key={item.title} className={styles.row}>
                <div className={styles.rowMeta}>
                  <p className={styles.category}>{item.source}</p>
                  <time dateTime={item.date}>{item.date.replaceAll("-", ".")}</time>
                </div>
                <div className={styles.rowCopy}>
                  <h2>
                    {item.slug ? (
                      <Link href={`/news/${item.slug}`}>{item.title}</Link>
                    ) : (
                      <a href={item.href} target="_blank" rel="noreferrer">{item.title}</a>
                    )}
                  </h2>
                  <p>{item.summary}</p>
                </div>
                {item.slug ? (
                  <Link href={`/news/${item.slug}`} className={styles.rowLink}>
                    소식 자세히 보기 <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                ) : (
                  <a href={item.href} target="_blank" rel="noreferrer" className={styles.rowLink}>
                    기사 보기 <ExternalLink size={16} aria-hidden="true" />
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
      <ContactBand />
    </>
  );
}
