import Image from "next/image";
import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import RelatedServices from "@/components/RelatedServices";
import CertificationFlow from "@/components/CertificationFlow";
import { consultingTracks, quickWins, services } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import styles from "@/components/BusinessPages.module.css";

const service = services.find((s) => s.slug === "consulting")!;

export const metadata: Metadata = {
  title: "경영컨설팅",
  description: service.summary,
  alternates: { canonical: buildCanonical("/services/consulting") },
};

export default function ConsultingPage() {
  return (
    <div className={styles.page}>
      <JsonLd data={[
        breadcrumbSchema([
          { name: "홈", href: "/" },
          { name: "사업영역", href: "/services/consulting" },
          { name: "경영컨설팅", href: "/services/consulting" },
        ]),
        faqSchema(service.faq),
      ]} />
      <PageHero
        eyebrow="경영컨설팅"
        title="기업 성장 단계에 맞춘 종합 경영컨설팅"
        description="아이디어 단계부터 개발·제조·사업화·비즈니스 모델 수립·전략 설계까지, 경영 전반의 전 과정을 함께 준비합니다."
        ctaHref="/contact"
        ctaLabel="상담 문의하기"
      />

      <section className={styles.section}>
        <div className={styles.intro}>
          <div className={styles.introImage}>
            <Image src="/images/brand/woolim-workspace-hero-v1.webp" alt="문서와 자료를 정리한 울림컴퍼니 브랜드 작업공간 이미지" fill sizes="(max-width: 800px) 100vw, 50vw" />
          </div>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>단계별 컨설팅</p>
            <h2 className={styles.heading}>기업 단계별 맞춤 컨설팅.</h2>
            <p className={styles.lead}>좋은 아이디어가 실제 사업이 될 수 있도록, 성장 단계에 맞는 방향을 함께 만들어갑니다.</p>
            <ul className={styles.plainList}>{service.points.map((point) => <li key={point}>{point}</li>)}</ul>
          </div>
        </div>
        <div className={styles.threeColumns}>
          {consultingTracks.map(({ icon: Icon, title, desc, points }, index) => (
            <article key={title} className={styles.feature}>
              <div className={styles.featureIcon}><span className={styles.number}>0{index + 1}</span><Icon size={23} aria-hidden="true" /></div>
              <h3>{title}</h3><p>{desc}</p>
              <ul className={styles.plainList}>{points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <SectionHeader
            eyebrow="성과"
            title="선정으로 증명한 컨설팅"
            description="예비창업패키지부터 TIPS R&D까지, 실제 기업과 함께 만든 선정 성과입니다."
          />
          <div className={styles.results}>
            {quickWins.map((win) => (
              <article key={win.item + "-" + win.program} className={styles.result}>
                <p>{win.item}</p><h3>{win.program}</h3><strong>{win.amount}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          eyebrow="기업인증"
          title="기업인증 컨설팅"
          description="기업인증은 기술력·경영역량·혁신성·연구개발 역량과 대외 신뢰도를 보여주는 중요한 성장 기반입니다."
        />
        <CertificationFlow />
        <p className={styles.note}>※ 인증별 혜택은 인증 종류·기업 요건·시행기관·사업 공고에 따라 달라질 수 있습니다. 상담을 통해 기업에 적용 가능한 인증과 혜택을 검토해 드립니다.</p>
      </section>

      <FaqList faqs={service.faq} />
      <RelatedServices currentSlug="consulting" />
      <ContactBand />
    </div>
  );
}
