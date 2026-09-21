import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Award, BadgeCheck, Banknote, Car, Clock, FileText, Landmark, Mail, MapPin, MessageCircle, Phone, Printer, TrainFront } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { ceo, trustSignals } from "@/data/content";
import { site, stats } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema } from "@/lib/schema";
import styles from "@/components/BusinessPages.module.css";

export const metadata: Metadata = {
  title: "회사소개",
  description: "울림컴퍼니의 철학과 대표 전문성, 자금조달·기업인증·정부지원사업·비즈니스문서까지 4대 서비스를 소개합니다.",
  alternates: { canonical: buildCanonical("/about") },
};

const pillars = [
  { icon: Banknote, title: "자금조달 컨설팅", desc: "기업의 현재 상황과 성장 가능성을 분석해 정책자금·운전자금·시설자금 등 적합한 자금조달 방향을 제안합니다." },
  { icon: BadgeCheck, title: "기업인증 컨설팅", desc: "업종·업력·보유 역량을 검토해 여성기업·사회적기업·벤처·연구소·메인비즈·이노비즈 등 필요한 인증 취득을 지원합니다." },
  { icon: Landmark, title: "정부지원사업·R&D", desc: "기업에 적합한 정부지원사업과 R&D 과제를 발굴하고, 선정 가능성을 높이는 사업계획 수립과 자료 작성을 지원합니다." },
  { icon: FileText, title: "비즈니스문서 기획·디자인", desc: "회사소개서·IR 자료·제안서·PPT 등 기업의 가치를 효과적으로 전달하는 비즈니스 문서를 기획하고 디자인합니다." },
];
const credentials = [...new Set([...ceo.credentials, ...trustSignals])];
const mapSrc = "https://www.google.com/maps?q=" + encodeURIComponent(site.address) + "&hl=ko&z=17&output=embed";
const contactInfo = [
  { icon: MapPin, label: "주소", value: site.address },
  { icon: Phone, label: "대표번호", value: site.phone, href: "tel:" + site.phone.replaceAll("-", "") },
  { icon: Printer, label: "팩스", value: site.fax },
  { icon: Mail, label: "이메일", value: site.email, href: "mailto:" + site.email },
  { icon: Clock, label: "운영시간", value: site.businessHours + " (" + site.closedDays + " 휴무)" },
  { icon: MessageCircle, label: "카카오톡 채널", value: "채널로 바로 문의하기", href: site.kakaoUrl },
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <JsonLd data={breadcrumbSchema([{ name: "홈", href: "/" }, { name: "회사소개", href: "/about" }])} />
      <PageHero
        eyebrow="회사소개"
        title="기업의 성장이 곧 우리의 성장이라는 믿음"
        description="울림컴퍼니는 기업이 가진 가능성이 실제 성과로 이어질 수 있도록 전략과 실행, 문서와 디자인을 연결합니다."
      />

      <div className={styles.brandVisual}>
        <div className={styles.brandImage}>
          <Image src="/images/brand/woolim-workspace-hero-v1.webp" alt="자연광 아래 문서와 제본 책이 놓인 울림컴퍼니 브랜드 작업공간 이미지" fill sizes="(max-width: 1504px) 100vw, 1440px" preload />
        </div>
        <div className={styles.brandCaption}>
          <strong>기업의 가능성을 성과로 연결합니다</strong>
          <span>{site.name} · WOOLIM COMPANY · Business Growth Partner</span>
        </div>
      </div>

      <section id="greeting" className={styles.section + " scroll-mt-24"}>
        <div className={styles.greeting}>
          <div className={styles.philosophy}>
            <p className={styles.eyebrow}>대표 인사말</p>
            <h2 className={styles.heading}>기업의 강점이 제대로 전달되도록 함께합니다.</h2>
            <p className={styles.philosophyNote}>기업의 성장이 곧 우리의 성장이라는 믿음.</p>
            <div className={styles.philosophyMark} aria-hidden="true"><span>WOOLIM</span><span>GROWING TOGETHER</span></div>
          </div>
          <div>
            <div className={styles.greetingText}>{ceo.greeting.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            <div className={styles.signature}><strong>{ceo.name}</strong><span>{ceo.title}</span></div>
          </div>
        </div>
      </section>

      <section className={styles.muted}>
        <div className={styles.section}>
          <SectionHeader
            eyebrow="서비스 구성"
            title="성장 단계에 필요한 모든 과정을 한곳에서"
            description="울림컴퍼니는 자금조달, 기업인증, 정부지원사업, 비즈니스 문서 기획·디자인까지 기업 성장에 필요한 맞춤형 컨설팅을 제공합니다."
          />
          <div className={styles.fourColumns}>
            {pillars.map(({ icon: Icon, title, desc }, index) => (
              <article key={title} className={styles.feature}>
                <div className={styles.featureIcon}><span className={styles.number}>0{index + 1}</span><Icon size={24} aria-hidden="true" /></div>
                <h3>{title}</h3><p>{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.expertise}>
          <div>
            <p className={styles.eyebrow}>전문성 · 주요 약력</p>
            <h2 className={styles.heading}>검증된 전문성,<br />경험으로 쌓은 신뢰.</h2>
            <Link href="#greeting" className={styles.textLink}>대표 소개 보기 <ArrowUpRight size={18} aria-hidden="true" /></Link>
          </div>
          <ul className={styles.credentials}>
            {credentials.map((item, index) => <li key={item}><span className={styles.number}>0{index + 1}</span><span>{item}</span></li>)}
          </ul>
        </div>
        <div className={styles.award}><Award size={26} aria-hidden="true" /><p>{site.award}</p></div>
        <dl className={styles.stats}>{stats.map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>
      </section>

      <section id="location" className={styles.muted + " " + styles.location}>
        <div className={styles.section}>
          <SectionHeader eyebrow="오시는 길" title="울림컴퍼니 위치" description="방문 상담은 전화 또는 카카오톡 채널로 일정을 먼저 문의해 주세요." />
          <div className={styles.locationGrid}>
            <div className={styles.map}>
              <iframe title="울림컴퍼니 위치" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
            <dl className={styles.contactDetails}>
              {contactInfo.map(({ icon: Icon, label, value, href }) => (
                <div key={label}>
                  <dt><Icon size={16} aria-hidden="true" />{label}</dt>
                  <dd>{href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{value}</a> : value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={styles.twoColumns + " " + styles.directions}>
            <article className={styles.feature}>
              <h3><TrainFront size={22} aria-hidden="true" />대중교통 이용 시</h3>
              <p>{site.directions.transit}</p><p className={styles.note}>{site.directions.note}</p>
            </article>
            <article className={styles.feature}>
              <h3><Car size={22} aria-hidden="true" />자가용 이용 시</h3>
              <p>{site.directions.parking}</p>
            </article>
          </div>
        </div>
      </section>
      <ContactBand />
    </div>
  );
}
