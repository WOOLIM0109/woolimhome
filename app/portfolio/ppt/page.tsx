import styles from "@/components/PortfolioSuccess.module.css";
import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import ProjectGallery from "@/components/ProjectGallery";
import { projectDocCategories } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "포트폴리오 | PPT",
  description:
    "울림컴퍼니의 회사소개서, 제안서, 보고서, 발표자료 등 기획형 PPT 포트폴리오를 소개합니다.",
  alternates: { canonical: buildCanonical("/portfolio/ppt") },
};

const pptCategories = projectDocCategories.filter((category) => ["intro", "proposal", "report"].includes(category.key));

export default function PortfolioPptPage() {
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "포트폴리오", href: "/portfolio" },
            { name: "PPT", href: "/portfolio/ppt" },
          ]),
          itemListSchema(
            "PPT 포트폴리오",
            pptCategories.map((category) => ({
              title: category.label,
              description: category.description,
              href: "/portfolio/ppt",
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="포트폴리오"
        title="PPT 포트폴리오"
        description="회사소개서·제안서·보고서·발표자료까지, 목적에 맞춰 설계한 기획형 PPT 결과물입니다."
      />
      <section className="bg-white">
        <div className={styles.content}>
          <ProjectGallery allowedCategories={["intro", "proposal", "report"]} />
        </div>
      </section>
      <ContactBand />
    </div>
  );
}