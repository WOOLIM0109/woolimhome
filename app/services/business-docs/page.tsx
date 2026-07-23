import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import { docProcess, docTypes, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";

const service = services.find((s) => s.slug === "business-docs")!;

export const metadata: Metadata = {
  title: "비즈니스문서/PPT",
  description: service.summary,
  alternates: { canonical: buildCanonical("/services/business-docs") },
};

const targets = [
  "회사소개서·제안서를 새롭게 제작하고 싶은 기업",
  "기존 PPT 자료를 전문적으로 보완하고 싶은 기업",
  "정부지원사업·R&D·정책자금 신청을 준비하는 기업",
  "투자유치·IR 발표자료가 필요한 기업",
  "제품·서비스를 이해하기 쉽게 소개하고 싶은 기업",
  "입찰·제휴·납품·영업용 제안서가 필요한 기업",
];

const samples = ["/images/portfolio/p-37.png", "/images/portfolio/p-33.png", "/images/portfolio/p-18.png"];

export default function BusinessDocsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "사업영역", href: "/services/consulting" },
            { name: "비즈니스문서/PPT", href: "/services/business-docs" },
          ]),
          faqSchema(service.faq),
        ]}
      />
      <PageHero
        eyebrow="비즈니스문서·PPT"
        title="단순한 디자인이 아닌, 문서의 목적과 흐름을 설계합니다"
        description="좋은 아이템과 사업성을 가지고 있어도 흐름이 부족하면 강점이 전달되기 어렵습니다. 읽는 사람이 쉽게 이해하고 설득되는 문서 구조를 설계합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      {/* 이런 기업에게 필요 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader eyebrow="이런 기업에게" title="이런 기업에게 필요합니다" />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {targets.map((t) => (
              <div key={t} className="card flex-row items-start gap-3 p-6">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <p className="text-sm leading-7 text-[#2d241d]">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 제작 프로세스 4단계 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="제작 과정"
            title="기획부터 디자인까지, 한 번에 연결"
            description="복잡한 자료에서 핵심을 뽑아 흐름을 만들고, 정보 구조와 디자인을 함께 설계합니다."
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {docProcess.map((p) => (
              <article key={p.step} className="card h-full p-6">
                <span className="text-3xl font-bold text-[var(--primary)]/30">{p.step}</span>
                <h3 className="mt-3 text-lg font-bold text-[#14100c]">{p.title}</h3>
                <p className="prose-muted mt-3 flex-1 text-sm">{p.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 제작 분야 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader eyebrow="제작 분야" title="이런 문서를 만듭니다" />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docTypes.map(({ icon: Icon, name, desc }) => (
              <div key={name} className="card h-full flex-row gap-4 p-6">
                <Icon size={22} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <div>
                  <h3 className="font-bold text-[#14100c]">{name}</h3>
                  <p className="prose-muted mt-2 text-sm">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 실제 제작 사례 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="제작 사례"
            title="실제 제작 사례"
            description="대기업·공공기관과 함께한 기획형 문서 디자인. 더 많은 사례는 프로젝트에서 확인하실 수 있습니다."
            linkHref="/projects/business-docs"
            linkLabel="프로젝트 전체 보기"
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {samples.map((src, i) => (
              <div key={src} className="card overflow-hidden p-0">
                <div className="relative aspect-[4/3] w-full bg-white">
                  <Image src={src} alt={`비즈니스문서 제작 사례 ${i + 1}`} fill sizes="(max-width:768px) 100vw, 33vw" className="object-cover" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 울림은 다릅니다 */}
      <section className="bg-[var(--deep)] text-white">
        <div className="mx-auto max-w-4xl px-5 py-16 text-center lg:px-8 lg:py-24">
          <Sparkles className="mx-auto text-[#ef8e36]" size={32} />
          <h2 className="section-title mt-5 text-3xl lg:text-4xl">울림은 다릅니다</h2>
          <p className="mt-6 text-base leading-8 text-white/70">
            울림컴퍼니는 AI가 등장하기 전부터 수많은 비즈니스 문서를 직접 기획하고 디자인해 온 전문가들이 함께합니다.
            전문가의 기획력으로 문서의 목적과 흐름을 설계하고, AI 기반 검토로 논리·표현·구성의 완성도를 한 번 더
            점검합니다. 사람의 감각과 기술의 정확성이 함께 작동하는 제작 시스템으로 더 설득력 있는 문서를 완성합니다.
          </p>
          <Link
            href="/contact"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-[var(--primary)] transition hover:-translate-y-0.5"
          >
            제작 문의하기 <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="business-docs" />
      <ContactBand />
    </>
  );
}
