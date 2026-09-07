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
    title: "PPT",
    description: "발표자료, 제안서, 보고서, 회사소개서 등 목적에 맞게 설계한 기획형 PPT 결과물입니다.",
  },
  {
    href: "/portfolio/design",
    icon: Palette,
    title: "디자인",
    description: "로고, 명함, 카다로그, 브로셔, 리플렛, 포스터 등 시각디자인 제작 범위를 정리합니다.",
  },
  {
    href: "/portfolio/business-ir",
    icon: FileText,
    title: "사업계획서/IR",
    description: "사업모델, 시장성, 수익구조, 투자 설득 흐름을 담은 사업계획서와 IR 자료입니다.",
  },
];

export default function PortfolioPage() {
  return (
    <>
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
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="Portfolio"
            title="보고 싶은 결과물부터 선택하세요"
            description="서비스 설명보다 실제 결과물 확인이 필요한 분들을 위해 포트폴리오를 분야별로 나누었습니다."
          />
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
            {portfolioMenus.map(({ href, icon: Icon, title, description }) => (
              <Link key={href} href={href} className="card card-hover h-full p-7">
                <Icon className="text-[var(--primary)]" size={30} />
                <h2 className="mt-6 text-2xl font-bold text-[#14100c]">{title}</h2>
                <p className="prose-muted mt-4 flex-1 text-sm">{description}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
                  포트폴리오 보기 <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <ContactBand />
    </>
  );
}
