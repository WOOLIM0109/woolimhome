import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPublishedColumnsResult } from "@/lib/columns/data";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";
import styles from "../news/editorial.module.css";

export const metadata: Metadata = {
  title: "칼럼",
  description: "정부지원사업, 사업계획서, IR 자료, 입찰제안서 준비에 도움이 되는 울림컴퍼니 칼럼입니다.",
  alternates: { canonical: buildCanonical("/columns") },
};

export const revalidate = 300;

export default async function ColumnsPage() {
  const { posts: publishedColumns, available } = await getPublishedColumnsResult();
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "인사이트", href: "/news" }, { name: "칼럼", href: "/columns" }]),
          itemListSchema("울림컴퍼니 칼럼", publishedColumns.map((item) => ({
            title: item.title,
            description: item.excerpt || "",
            href: `/columns/${item.slug}`,
          }))),
        ]}
      />
      <PageHero eyebrow="인사이트" title="칼럼" description="사업계획서, IR, 입찰제안서, 정부지원사업 준비에 필요한 실무 관점을 정리합니다." />
      <section className={styles.page} aria-label="울림컴퍼니 칼럼">
        <div className={styles.shell}>
          <nav className={styles.tabs} aria-label="인사이트 메뉴">
            <Link href="/news">소식</Link>
            <Link href="/columns" aria-current="page">칼럼</Link>
          </nav>
          <div className={styles.list}>
            <div className={styles.listHeading}>
              <h2>사업을 위한 실무 이야기</h2>
              <span>{available ? `전체 ${publishedColumns.length}건` : "불러오기 지연"}</span>
            </div>
            {publishedColumns.map((item) => (
              <article key={item.id} className={styles.row}>
                <div className={styles.rowMeta}>
                  <p className={styles.category}>{item.category || "Column"}</p>
                  <time dateTime={item.published_at || item.created_at}>
                    {new Date(item.published_at || item.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                  </time>
                </div>
                <div className={styles.rowCopy}>
                  <h2><Link href={`/columns/${item.slug}`}>{item.title}</Link></h2>
                  <p>{item.excerpt}</p>
                </div>
                <Link href={`/columns/${item.slug}`} className={styles.rowLink}>
                  자세히 읽기 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
            {publishedColumns.length === 0 && (
              <p className={styles.empty}>
                {available
                  ? "아직 공개된 칼럼이 없습니다."
                  : "칼럼을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요."}
              </p>
            )}
          </div>
        </div>
      </section>
      <ContactBand />
    </>
  );
}
