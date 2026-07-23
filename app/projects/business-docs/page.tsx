import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import ProjectGallery from "@/components/ProjectGallery";
import { projectDocCategories } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "프로젝트 | 비즈니스문서/PPT",
  description:
    "울림컴퍼니의 회사소개서, 제안서, 사업계획서, IR, 보고서, 발표자료 프로젝트를 대기업·공공기관 사례 중심으로 소개합니다.",
  alternates: { canonical: buildCanonical("/projects/business-docs") },
};

export default function BusinessProjectsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "프로젝트", href: "/projects/business-docs" },
            { name: "비즈니스문서/PPT", href: "/projects/business-docs" },
          ]),
          itemListSchema(
            "비즈니스문서/PPT 프로젝트",
            projectDocCategories.map((c) => ({
              title: c.label,
              description: c.description,
              href: "/projects/business-docs",
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="프로젝트"
        title="비즈니스문서/PPT 프로젝트"
        description="소개서·제안서·사업계획서·IR·발표자료까지, 목적에 맞춰 설계한 기획형 문서 디자인 결과물입니다."
      />
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <ProjectGallery />
        </div>
      </section>
      <ContactBand />
    </>
  );
}
