import Image from "next/image";
import styles from "@/components/PortfolioSuccess.module.css";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileText, Palette, Presentation } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "포트폴리오",
  description:
    "울림컴퍼니가 기획·디자인한 PPT, 디자인, 사업계획서/IR 포트폴리오를 확인할 수 있습니다.",
  alternates: { canonical: buildCanonical("/portfolio") },
};

const portfolioMenus = [
  {
    href: "/portfolio/ppt",
    icon: Presentation,
    image: "/images/brand/woolim-document-studio-v2.webp",
    imageAlt: "울림의 문서 기획과 프레젠테이션 작업을 표현한 브랜드 컨셉 이미지",
    title: "PPT",
    description: "발표자료, 제안서, 보고서, 회사소개서 등 목적에 맞게 설계한 기획형 PPT 결과물입니다.",
  },
  {
    href: "/portfolio/design",
    icon: Palette,
    image: "/images/brand/woolim-brand-system-v2.webp",
    imageAlt: "브랜드 컬러와 인쇄물 디자인을 표현한 울림의 브랜드 컨셉 이미지",
    title: "디자인",
    description: "로고, 명함, 카다로그, 브로셔, 리플렛, 포스터 등 브랜드에 맞춘 시각디자인 결과물입니다.",
  },
  {
    href: "/portfolio/business-ir",
    icon: FileText,
    image: "/images/brand/woolim-strategy-studio-v2.webp",
    imageAlt: "사업 전략과 비즈니스 기획 작업을 표현한 울림의 브랜드 컨셉 이미지",
    title: "사업계획서/IR",
    description: "사업모델, 시장성, 수익구조, 투자 설득 흐름을 담은 사업계획서와 IR 자료입니다.",
  },
];

export default function PortfolioPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "포트폴리오", href: "/portfolio" }]),
          itemListSchema("울림컴퍼니 포트폴리오", portfolioMenus.map((item) => ({
            title: item.title,
            description: item.description,
            href: item.href,
          }))),
        ]}
      />
      <PageHero
        eyebrow="포트폴리오"
        title="기획과 디자인으로 완성한 실제 결과물"
        description="울림컴퍼니가 직접 기획하고 디자인한 PPT, 디자인, 사업계획서/IR 결과물을 분야별로 확인할 수 있습니다."
      />
      <section className="bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="Portfolio"
            title="보고 싶은 결과물부터 선택하세요"
            description="PPT부터 브랜딩, 사업계획서와 IR까지 목적에 맞는 제작 사례를 살펴보세요."
          />
          <div className={styles.portfolioMenus}>
            {portfolioMenus.map(({ href, icon: Icon, image, imageAlt, title, description }) => (
              <Link key={href} href={href} className={styles.portfolioMenu}>
                <div className={styles.menuImage}>
                  <Image
                    src={image}
                    alt={imageAlt}
                    fill
                    sizes="(max-width: 767px) 100vw, (max-width: 1504px) 33vw, 450px"
                  />
                </div>
                <div className={styles.menuCopy}>
                  <Icon className="text-[#eb6826]" size={22} aria-hidden="true" />
                  <h2 className="mt-6 text-2xl font-bold text-[#171717]">{title}</h2>
                  <p className="prose-muted mt-4 flex-1 text-base lg:text-[17px]">{description}</p>
                  <span className="mt-6 inline-flex items-center gap-2 text-base lg:text-[17px] font-bold text-[#eb6826]">
                    포트폴리오 보기 <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <ContactBand />
    </div>
  );
}