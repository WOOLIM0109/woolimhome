import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import { ceo } from "@/data/content";
import { site } from "@/data/site";
import { SITE_URL, buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema } from "@/lib/schema";
import styles from "@/components/BusinessPages.module.css";

export const metadata: Metadata = {
  title: "대표 소개",
  description: site.name + " 대표 " + ceo.name + " — 국가공인 경영지도사 33기, 중기부 비즈니스지원단 클리닉 위원. 기업 성장을 위한 맞춤 컨설팅을 제공합니다.",
  alternates: { canonical: buildCanonical("/about/ceo") },
};

function personSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: ceo.name,
    jobTitle: "국가공인 경영지도사 / 울림컴퍼니 대표",
    worksFor: { "@id": SITE_URL + "/#organization" },
    knowsAbout: ["경영컨설팅", "정부지원사업", "기업인증", "사업계획서", "IR 자료"],
    description: ceo.credentials.join(", "),
  };
}

export default function CeoPage() {
  return (
    <div className={styles.page}>
      <JsonLd data={[
        breadcrumbSchema([
          { name: "홈", href: "/" },
          { name: "회사소개", href: "/about" },
          { name: "대표 소개", href: "/about/ceo" },
        ]),
        personSchema(),
      ]} />
      <PageHero
        eyebrow="대표 소개"
        title="기업의 가능성을 함께 키우는 파트너"
        description="대표가 직접 찾아뵙고, 사업 성장을 위한 로드맵을 제안합니다."
      />

      <section className={styles.section}>
        <div className={styles.greeting}>
          <div className={styles.philosophy}>
            <p className={styles.eyebrow}>대표 인사말</p>
            <h2 className={styles.heading}>함께 고민하고, 함께 성장합니다.</h2>
            <p className={styles.philosophyNote}>기업의 성장이 곧 우리의 성장이라는 믿음.</p>
            <div className={styles.philosophyMark} aria-hidden="true"><span>WOOLIM</span><span>GROWING TOGETHER</span></div>
          </div>
          <div>
            <div className={styles.greetingText}>
              {ceo.greeting.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <div className={styles.signature}><strong>{ceo.name}</strong><span>{ceo.title}</span></div>
          </div>
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <div className={styles.expertise}>
            <div><p className={styles.eyebrow}>약력</p><h2 className={styles.heading}>주요 약력</h2></div>
            <ul className={styles.credentials}>
              {ceo.credentials.map((item, index) => <li key={item}><span className={styles.number}>0{index + 1}</span><span>{item}</span></li>)}
            </ul>
          </div>
        </div>
      </section>
      <ContactBand />
    </div>
  );
}
