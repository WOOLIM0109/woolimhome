import type { Metadata } from "next";
import { Palette } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import { designDifferentiators, designFields, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";

const service = services.find((s) => s.slug === "design")!;

export const metadata: Metadata = {
  title: "디자인서비스",
  description: service.summary,
  alternates: { canonical: buildCanonical("/services/design") },
};

export default function DesignServicePage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "사업영역", href: "/services/consulting" },
            { name: "디자인서비스", href: "/services/design" },
          ]),
          faqSchema(service.faq),
        ]}
      />
      <PageHero
        eyebrow="디자인 서비스"
        title="브랜드의 첫인상을 완성하는 맞춤형 디자인"
        description="로고·명함·카다로그·브로셔·리플렛·전단·포스터 등 기업과 브랜드를 알리는 데 필요한 다양한 디자인물을 제작합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      {/* 제작 분야 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="제작 분야"
            title="주요 제작 분야"
            description="기업의 업종·브랜드 이미지·활용 목적·타깃 고객을 고려해 온·오프라인에서 활용 가능한 완성도 높은 결과물을 제공합니다."
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designFields.map((f) => (
              <div key={f.name} className="card h-full p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Palette size={20} />
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#14100c]">{f.name}</h3>
                <p className="prose-muted mt-2 flex-1 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 차별점 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="차별점"
            title="울림컴퍼니 디자인의 차별점"
            description="좋은 디자인은 브랜드 이미지를 선명하게 만들고, 고객에게 더 오래 기억되는 인상을 남깁니다."
          />
          <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-3">
            {designDifferentiators.map((d, i) => (
              <article key={d.title} className="card h-full p-7">
                <span className="text-3xl font-bold text-[var(--primary)]/30">0{i + 1}</span>
                <h3 className="mt-3 text-lg font-bold text-[#14100c]">{d.title}</h3>
                <p className="prose-muted mt-3 text-sm">{d.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="design" />
      <ContactBand />
    </>
  );
}
