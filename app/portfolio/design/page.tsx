import styles from "@/components/PortfolioSuccess.module.css";
import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import DesignPortfolioGallery from "@/components/DesignPortfolioGallery";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { designFields } from "@/data/content";
import { designPortfolioProjects } from "@/data/design-portfolio";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "포트폴리오 | 디자인",
  description:
    "울림컴퍼니가 제작한 리플렛·카탈로그, 로고·브랜딩, 인포그래픽, 포스터, 배너·공간 그래픽 포트폴리오입니다.",
  alternates: { canonical: buildCanonical("/portfolio/design") },
};

export default function PortfolioDesignPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "포트폴리오", href: "/portfolio" },
            { name: "디자인", href: "/portfolio/design" },
          ]),
          itemListSchema(
            "디자인 포트폴리오",
            designPortfolioProjects.map((project) => ({
              title: `${project.client} ${project.title}`,
              description: project.summary,
              href: `/portfolio/design#${project.id}`,
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="포트폴리오"
        title="디자인 포트폴리오"
        description="브랜드의 첫인상부터 복잡한 정보의 시각화까지, 실제 제작 결과물을 분야별로 정리했습니다."
      />

      <section className="bg-[#ffffff]">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="실제 제작 사례"
            title="종류별 디자인 포트폴리오"
            description="인쇄·편집부터 브랜딩, 인포그래픽, 포스터와 공간 그래픽까지 실제 공개 가능한 결과물을 모았습니다."
          />
          <div className="mt-9">
            <DesignPortfolioGallery />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="제작 범위"
            title="이런 디자인을 만듭니다"
            description="브랜드와 목적에 맞춰 인쇄물부터 공간 그래픽까지 설계합니다."
          />
          <div className="mt-9 grid border-l border-t border-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
            {designFields.map((field) => (
              <article key={field.name} className="border-b border-r border-[var(--line)] p-5 sm:p-6">
                <h2 className="text-base lg:text-[18px] font-bold text-[#171717]">{field.name}</h2>
                <p className="mt-2 text-base lg:text-[17px] leading-7 text-[var(--muted)]">{field.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ContactBand />
    </div>
  );
}