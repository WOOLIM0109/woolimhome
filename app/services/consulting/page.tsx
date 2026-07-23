import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import { certBenefits, certifications, consultingTracks, quickWins, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";

const service = services.find((s) => s.slug === "consulting")!;

export const metadata: Metadata = {
  title: "경영컨설팅",
  description: service.summary,
  alternates: { canonical: buildCanonical("/services/consulting") },
};

export default function ConsultingPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "사업영역", href: "/services/consulting" },
            { name: "경영컨설팅", href: "/services/consulting" },
          ]),
          faqSchema(service.faq),
        ]}
      />
      <PageHero
        eyebrow="경영컨설팅"
        title="기업 성장 단계에 맞춘 종합 경영컨설팅"
        description="아이디어 단계부터 개발·제조·사업화·비즈니스 모델 수립·전략 설계까지, 경영 전반의 전 과정을 함께 준비합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      {/* 3개 트랙 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="단계별 컨설팅"
            title="기업 단계별 맞춤 컨설팅"
            description="좋은 아이디어가 실제 사업이 될 수 있도록, 성장 단계에 맞는 방향을 함께 만들어갑니다."
          />
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
            {consultingTracks.map(({ icon: Icon, title, desc, points }) => (
              <article key={title} className="card h-full p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Icon size={24} />
                </div>
                <h3 className="mt-5 text-xl font-bold text-[#14100c]">{title}</h3>
                <p className="prose-muted mt-3 text-sm">{desc}</p>
                <ul className="mt-5 space-y-2.5 border-t border-[var(--line)] pt-5">
                  {points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm leading-6 text-[#2d241d]">
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 빠른 성과 사례 */}
      <section className="bg-[var(--deep)] text-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="성과"
            light
            title="선정으로 증명한 컨설팅"
            description="예비창업패키지부터 TIPS R&D까지, 실제 기업과 함께 만든 선정 성과입니다."
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quickWins.map((w) => (
              <div key={`${w.item}-${w.program}`} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm text-white/60">{w.item}</p>
                <p className="mt-2 text-base font-bold text-white">{w.program}</p>
                <p className="mt-4 text-2xl font-bold text-[#ef8e36]">{w.amount}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 기업인증 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="기업인증"
            title="기업인증 컨설팅"
            description="기업인증은 기술력·경영역량·혁신성·연구개발 역량과 대외 신뢰도를 보여주는 중요한 성장 기반입니다."
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certifications.map((c) => (
              <div key={c.name} className="card h-full p-6">
                <h3 className="text-lg font-bold text-[var(--primary)]">{c.name}</h3>
                <p className="prose-muted mt-3 text-sm">{c.desc}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-14 text-xl font-bold text-[#14100c]">기업인증 주요 혜택</h3>
          <div className="mt-6 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certBenefits.map((b) => (
              <div key={b.title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6">
                <p className="font-bold text-[#14100c]">{b.title}</p>
                <p className="prose-muted mt-2 text-sm">{b.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-6 text-[var(--muted)]">
            ※ 인증별 혜택은 인증 종류·기업 요건·시행기관·사업 공고에 따라 달라질 수 있습니다. 상담을 통해 기업에 적용
            가능한 인증과 혜택을 검토해 드립니다.
          </p>
        </div>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="consulting" />
      <ContactBand />
    </>
  );
}
