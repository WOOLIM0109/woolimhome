import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import ProjectGallery from "@/components/ProjectGallery";
import { projectDocCategories } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "포트폴리오 | 사업계획서/IR",
  description:
    "울림컴퍼니의 사업계획서, IR, 투자제안서, 정부지원사업 계획서 포트폴리오를 소개합니다.",
  alternates: { canonical: buildCanonical("/portfolio/business-ir") },
};

const businessIrCategories = projectDocCategories.filter((category) => category.key === "ir");

export default function PortfolioBusinessIrPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "포트폴리오", href: "/portfolio" },
            { name: "사업계획서/IR", href: "/portfolio/business-ir" },
          ]),
          itemListSchema(
            "사업계획서/IR 포트폴리오",
            businessIrCategories.map((category) => ({
              title: category.label,
              description: category.description,
              href: "/portfolio/business-ir",
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="포트폴리오"
        title="사업계획서/IR 포트폴리오"
        description="사업모델·시장성·수익구조·투자 설득 흐름을 체계적으로 정리한 사업계획서와 IR 자료입니다."
      />
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <ProjectGallery allowedCategories={["ir"]} defaultCategory="ir" />
        </div>
      </section>
      <ContactBand />
    </>
  );
}
