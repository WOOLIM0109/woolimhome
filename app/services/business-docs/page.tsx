import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import { docProcess, docTypes, portfolioProjects, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import styles from "@/components/BusinessPages.module.css";

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
const samples = portfolioProjects.slice(0, 3);

export default function BusinessDocsPage() {
  return (
    <div className={styles.page}>
      <JsonLd data={[
        breadcrumbSchema([
          { name: "홈", href: "/" },
          { name: "사업영역", href: "/services/consulting" },
          { name: "비즈니스문서/PPT", href: "/services/business-docs" },
        ]),
        faqSchema(service.faq),
      ]} />
      <PageHero
        eyebrow="비즈니스문서·PPT"
        title="단순한 디자인이 아닌, 문서의 목적과 흐름을 설계합니다"
        description="좋은 아이템과 사업성을 가지고 있어도 흐름이 부족하면 강점이 전달되기 어렵습니다. 읽는 사람이 쉽게 이해하고 설득되는 문서 구조를 설계합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      <section className={styles.section}>
        <div className={styles.intro}>
          <div className={styles.introImage}>
            <Image src="/images/brand/woolim-document-studio-v2.webp" alt="기획 문서와 프레젠테이션 작업을 표현한 울림컴퍼니 브랜드 이미지" fill sizes="(max-width: 800px) 100vw, 50vw" />
          </div>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>이런 기업에게</p>
            <h2 className={styles.heading}>이런 기업에게 필요합니다.</h2>
            <ul className={styles.plainList}>{targets.map((target) => <li key={target}>{target}</li>)}</ul>
          </div>
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <SectionHeader
            eyebrow="제작 과정"
            title="기획부터 디자인까지, 한 번에 연결"
            description="복잡한 자료에서 핵심을 뽑아 흐름을 만들고, 정보 구조와 디자인을 함께 설계합니다."
          />
          <div className={styles.fourColumns}>
            {docProcess.map((step) => (
              <article key={step.step} className={styles.feature}>
                <span className={styles.number}>{step.step}</span>
                <h3>{step.title}</h3><p>{step.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader eyebrow="제작 분야" title="이런 문서를 만듭니다" />
        <div className={styles.threeColumns}>
          {docTypes.map(({ icon: Icon, name, desc }, index) => (
            <article key={name} className={styles.feature}>
              <div className={styles.featureIcon}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><Icon size={23} aria-hidden="true" /></div>
              <h3>{name}</h3><p>{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <SectionHeader
            eyebrow="제작 사례"
            title="실제 제작 사례"
            description="실제 제작한 기획형 문서 디자인입니다. 더 많은 사례는 포트폴리오에서 확인하실 수 있습니다."
            linkHref="/portfolio"
            linkLabel="포트폴리오 전체 보기"
          />
          <div className={styles.threeColumns}>
            {samples.map((project) => (
              <Link key={project.id} href="/portfolio" className={styles.work}>
                <div className={styles.workImage}>
                  <Image src={"/images/projects/" + project.id + "/thumbnail.webp"} alt={project.company + " " + project.type + " 제작 사례"} fill sizes="(max-width: 639px) 100vw, 33vw" />
                </div>
                <div className={styles.workMeta}><span>{project.type}</span><ArrowUpRight size={18} aria-hidden="true" /></div>
                <h3>{project.company}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.statement}>
          <div><p className={styles.eyebrow}>OUR DIFFERENCE</p><h2 className={styles.heading}>울림은 다릅니다.</h2></div>
          <div>
            <p className={styles.lead}>
              울림컴퍼니는 AI가 등장하기 전부터 수많은 비즈니스 문서를 직접 기획하고 디자인해 온 전문가들이 함께합니다.
              전문가의 기획력으로 문서의 목적과 흐름을 설계하고, AI 기반 검토로 논리·표현·구성의 완성도를 한 번 더
              점검합니다. 사람의 감각과 기술의 정확성이 함께 작동하는 제작 시스템으로 더 설득력 있는 문서를 완성합니다.
            </p>
            <Link href="/contact" className={styles.button}>제작 문의하기 <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="business-docs" />
      <ContactBand />
    </div>
  );
}
