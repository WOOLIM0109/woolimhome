import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { pricingCore, pricingTables } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

/* ★ 비용안내 페이지 공개 여부 — 다시 열려면 이 값을 true 로 바꾸면 됩니다. */
const PRICING_OPEN = false;

export const metadata: Metadata = PRICING_OPEN
  ? {
      title: "비용안내",
      description:
        "울림컴퍼니 경영컨설팅·기업인증·사업계획서·PPT·카다로그·리플렛·포스터 디자인 기준 비용을 안내합니다.",
      alternates: { canonical: buildCanonical("/contact/pricing") },
    }
  : {
      title: "비용안내",
      description: "비용 안내 페이지는 현재 준비 중입니다. 자세한 비용은 상담을 통해 안내드립니다.",
      robots: { index: false, follow: true },
    };

export default function PricingPage() {
  if (!PRICING_OPEN) {
    return (
      <>
        <PageHero
          eyebrow="비용안내"
          title="비용 안내는 준비 중입니다"
          description="현재 비용 안내 페이지를 정비하고 있습니다. 서비스별 자세한 비용은 상담을 통해 정확하게 안내드립니다."
        />
        <section className="bg-white">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center lg:px-8 lg:py-28">
            <h2 className="section-title text-2xl text-[#14100c] lg:text-3xl">
              필요하신 비용은 상담으로 바로 안내드려요
            </h2>
            <p className="prose-muted mt-4 text-sm">
              경영컨설팅·기업인증·사업계획서·PPT·디자인 등 필요하신 서비스와 상황을 알려주시면,
              기업에 맞는 견적을 상담을 통해 안내드립니다.
            </p>
            <Link
              href="/contact"
              className="btn-gradient mt-8 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-bold text-white"
            >
              상담으로 견적 문의하기
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
        <ContactBand />
      </>
    );
  }

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "상담신청", href: "/contact" },
            { name: "비용안내", href: "/contact/pricing" },
          ]),
          itemListSchema(
            "울림컴퍼니 비용안내",
            pricingCore.map((item) => ({
              title: item.title,
              description: `${item.price} (${item.note}). ${item.detail}`,
              href: "/contact/pricing",
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="비용안내"
        title="비용안내"
        description="아래 금액은 기준 비용이며, 작업 범위·자료 준비 상태·디자인 난이도에 따라 상담 후 확정됩니다."
        ctaHref="/contact"
        ctaLabel="견적 문의하기"
      />

      {/* 컨설팅 핵심 비용 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader eyebrow="컨설팅" title="컨설팅 비용 안내" />
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
            {pricingCore.map(({ icon: Icon, title, price, note, detail }) => (
              <article key={title} className="card h-full p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Icon size={24} />
                </div>
                <h2 className="mt-5 text-lg font-bold text-[#14100c]">{title}</h2>
                <p className="mt-3 text-2xl font-bold text-[var(--primary)]">{price}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--accent)]">{note}</p>
                <p className="prose-muted mt-4 flex-1 text-sm">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 디자인 상세 가격표 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="디자인"
            title="디자인 제작 비용표"
            description="PPT·카다로그·브로셔·리플렛·포스터 등 제작물별 기준 단가입니다."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {pricingTables.map((table) => (
              <div key={table.title} className="card overflow-hidden p-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] bg-white px-6 py-5">
                  <h3 className="text-lg font-bold text-[#14100c]">{table.title}</h3>
                  {table.note && <span className="text-xs text-[var(--muted)]">{table.note}</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="bg-[var(--surface-strong)] text-left">
                        {table.columns.map((col) => (
                          <th key={col} className="px-5 py-3 font-bold text-[var(--muted)]">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-[var(--line)]">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className={`px-5 py-3.5 ${ci === 0 ? "font-bold text-[#2d241d]" : "font-semibold text-[var(--primary)]"}`}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-6 text-[var(--muted)]">
            ※ PPT 가격은 VAT 포함 기준이며, 인포그래픽형·맞춤기획은 작업 범위에 따라 별도 견적으로 안내드립니다.
          </p>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
