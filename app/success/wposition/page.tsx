import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import styles from "@/components/PortfolioSuccess.module.css";
import { getSuccessLedger } from "@/data/success-ledger";
import { formatWon, getSuccessMetrics } from "@/data/success-metrics";
import { breadcrumbSchema } from "@/lib/schema";
import { buildCanonical } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "아이템 설계부터 투자유치까지 | 대표 동행 사례",
  description: "AI 플랫폼 기업과 함께 아이템을 설계하고 IR 자료를 네 차례 제작하며 투자유치와 정부지원사업 선정으로 연결한 기록입니다.",
  alternates: { canonical: buildCanonical("/success/wposition") },
};

export default async function WpositionSuccessPage() {
  const [ledger, metrics] = await Promise.all([getSuccessLedger(), getSuccessMetrics()]);
  const records = ledger.filter((item) => item.clientKey === "wposition" && item.stage === "final" && item.publicApproved);
  const investment = records.find((item) => item.track === "investment");
  const tips = records.find((item) => item.id === "wposition-tips");
  const grants = records.filter((item) => item.track === "funding" && item.id !== "wposition-tips").sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  const stages = [
    { title: "아이템 설계", description: "사업 아이템과 성장 방향을 정리하고, 지원사업 전략과 투자 준비의 출발점을 함께 잡았습니다." },
    { title: "IR 1차 → 2차 → 3차 → 4차", description: "IR 자료를 네 차례 제작하며 단계별로 다듬었습니다. 컨설팅과 비즈니스문서·디자인을 하나의 과정으로 연결했습니다." },
    ...(investment ? [{ title: `투자유치 ${formatWon(investment.amountWon)} 원`, description: "TIPS 추천을 위한 투자를 유치했습니다. 공개 범위는 투자 금액과 단계입니다." }] : []),
    ...(tips ? [{ title: `TIPS 선정 ${formatWon(tips.amountWon)} 원`, description: "투자유치를 바탕으로 TIPS 기술창업지원에 최종 선정됐습니다." }] : []),
  ];
  return (
    <div className={styles.page}>
      <JsonLd data={breadcrumbSchema([{ name: "홈", href: "/" }, { name: "성공사례", href: "/success" }, { name: "대표 동행 사례", href: "/success/wposition" }])} />
      <PageHero eyebrow="대표 동행 사례 · AI 플랫폼 기업" title="아이템 설계부터 투자유치까지, 2년간 함께한 기록" description="성장 전략을 세우고 문서와 디자인으로 구체화해, 투자와 지원사업으로 이어간 과정입니다." />
      <section className={styles.content} aria-label="아이템 설계와 투자 준비 과정">
        <ol className="grid gap-6 md:grid-cols-2">
          {stages.map((stage, index) => <li key={stage.title} className="border-t-2 border-[#222] py-6"><p className="text-sm font-bold text-[var(--primary)]">{String(index + 1).padStart(2, "0")}</p><h2 className="mt-3 text-2xl font-bold">{stage.title}</h2><p className="mt-4 leading-8 text-[var(--muted)]">{stage.description}</p></li>)}
        </ol>
      </section>
      <section className="bg-[#f6f6f4]" id="investment">
        <div className={styles.content}>
          <h2 className="text-3xl font-bold">선정·투자 누계 {formatWon(metrics.wposition.totalWon)} 원</h2>
          <p className="mt-5 leading-8">투자유치 {formatWon(investment?.amountWon ?? 0)} 원 · 정부지원사업 {formatWon(metrics.wposition.fundingWon)} 원</p>
          <p className="mt-2 text-[var(--muted)]">정부지원사업에는 TIPS와 아래 {grants.length}건이 포함됩니다. 투자와 지원사업 금액을 구분해 집계합니다.</p>
          <h3 className="mt-10 text-xl font-bold">함께 연결한 지원사업 {grants.length}건 · {formatWon(grants.reduce((sum, item) => sum + item.amountWon, 0))} 원</h3>
          <ul className="mt-5 divide-y divide-[var(--line)]">
            {grants.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-3 py-4"><span>{item.year} · {item.program}</span><strong>{formatWon(item.amountWon)} 원</strong></li>)}
          </ul>
        </div>
      </section>
      <section className={styles.content}>
        <h2 className="text-2xl font-bold">전략부터 문서·디자인까지, 함께 상담하세요</h2>
        <p className="mt-4 leading-8 text-[var(--muted)]">현재 성장 단계와 필요한 자료를 알려주시면 컨설팅, 비즈니스문서, 디자인을 연결해 안내드립니다.</p>
        <Link href="/contact" className="mt-6 inline-block font-bold text-[var(--primary)]">상담 문의하기 →</Link>
      </section>
      <ContactBand />
    </div>
  );
}
