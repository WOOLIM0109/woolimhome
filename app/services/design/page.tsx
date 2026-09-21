import type { Metadata } from "next";
import Image from "next/image";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import { designDifferentiators, designFields, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import styles from "@/components/BusinessPages.module.css";

const service = services.find((s) => s.slug === "design")!;

export const metadata: Metadata = {
  title: "디자인서비스",
  description: service.summary,
  alternates: { canonical: buildCanonical("/services/design") },
};

export default function DesignServicePage() {
  return (
    <div className={styles.page}>
      <JsonLd data={[
        breadcrumbSchema([
          { name: "홈", href: "/" },
          { name: "사업영역", href: "/services/consulting" },
          { name: "디자인서비스", href: "/services/design" },
        ]),
        faqSchema(service.faq),
      ]} />
      <PageHero
        eyebrow="디자인 서비스"
        title="브랜드의 첫인상을 완성하는 맞춤형 디자인"
        description="로고·명함·카다로그·브로셔·리플렛·전단·포스터 등 기업과 브랜드를 알리는 데 필요한 다양한 디자인물을 제작합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      <section className={styles.section}>
        <div className={styles.intro}>
          <div className={styles.introImage}>
            <Image src="/images/brand/woolim-brand-system-v2.webp" alt="브랜드 로고와 인쇄물을 일관된 체계로 구성한 울림의 디자인 브랜드 이미지" fill sizes="(max-width: 800px) 100vw, 50vw" />
          </div>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>제작 분야</p>
            <h2 className={styles.heading}>주요 제작 분야.</h2>
            <p className={styles.lead}>기업의 업종·브랜드 이미지·활용 목적·타깃 고객을 고려해 온·오프라인에서 활용 가능한 완성도 높은 결과물을 제공합니다.</p>
            <ul className={styles.plainList}>{service.points.map((point) => <li key={point}>{point}</li>)}</ul>
          </div>
        </div>
        <div className={styles.threeColumns}>
          {designFields.map((field, index) => (
            <article key={field.name} className={styles.feature}>
              <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
              <h3>{field.name}</h3><p>{field.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <SectionHeader
            eyebrow="차별점"
            title="울림컴퍼니 디자인의 차별점"
            description="좋은 디자인은 브랜드 이미지를 선명하게 만들고, 고객에게 더 오래 기억되는 인상을 남깁니다."
          />
          <div className={styles.threeColumns}>
            {designDifferentiators.map((difference, index) => (
              <article key={difference.title} className={styles.feature}>
                <span className={styles.number}>0{index + 1}</span>
                <h3>{difference.title}</h3><p>{difference.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="design" />
      <ContactBand />
    </div>
  );
}
