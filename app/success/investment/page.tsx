import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import styles from "@/components/PortfolioSuccess.module.css";
import { getSuccessMetrics } from "@/data/success-metrics";
import { breadcrumbSchema } from "@/lib/schema";
import { buildCanonical } from "@/lib/site-config";

export const metadata: Metadata = { title: "성공사례 | 투자유치", description: "아이템 설계와 IR 자료 제작을 통해 TIPS 추천 투자와 지원사업 선정으로 이어진 투자유치 사례입니다.", alternates: { canonical: buildCanonical("/success/investment") } };

export default async function InvestmentSuccessPage() {
  const metrics = await getSuccessMetrics();
  return <div className={styles.page}>
    <JsonLd data={breadcrumbSchema([{ name: "홈", href: "/" }, { name: "성공사례", href: "/success" }, { name: "투자유치", href: "/success/investment" }])} />
    <PageHero eyebrow="성공사례" title="투자유치로 이어진 사업과 IR의 설계" description="정부지원사업·용역 낙찰과 구분해, 확정된 투자 금액과 단계를 안내합니다." />
    <section className={styles.content}>
      <p className="text-sm font-bold text-[var(--primary)]">투자유치 확정 {metrics.investment.count}건</p>
      <h2 className="mt-4 text-4xl font-bold">{metrics.investment.amount} 원 투자유치</h2>
      <p className="mt-6 max-w-3xl leading-8 text-[var(--muted)]">AI 플랫폼 기업의 아이템 설계부터 IR 자료 네 차례 제작까지 함께했습니다. TIPS 추천을 위한 투자를 유치하고 TIPS 선정으로 연결했습니다.</p>
      <Link className="mt-8 inline-block font-bold text-[var(--primary)]" href="/success/wposition">대표 동행 사례 전체 보기 →</Link>
    </section>
    <ContactBand />
  </div>;
}
