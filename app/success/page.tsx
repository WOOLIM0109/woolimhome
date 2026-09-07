import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Gavel, Landmark } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "성공사례",
  description:
    "울림컴퍼니가 함께 만든 정부지원사업·정책자금 선정 성과와 입찰·입점 성공사례를 소개합니다.",
  alternates: { canonical: buildCanonical("/success") },
};

const successMenus = [
  {
    href: "/success/funding",
    icon: Landmark,
    title: "정부지원사업/정책자금",
    description: "TIPS, R&D, 창업지원, 정책자금 등 실제 선정·유치로 이어진 컨설팅 성과입니다.",
  },
  {
    href: "/success/bidding-entry",
    icon: Gavel,
    title: "입찰/입점",
    description: "공공조달 입찰 낙찰, 백화점·플랫폼 입점, 제휴 제안 성과를 정리했습니다.",
  },
];

export default function SuccessPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "성공사례", href: "/success" }]),
          itemListSchema("울림컴퍼니 성공사례", successMenus.map((item) => ({
            title: item.title,
            description: item.description,
            href: item.href,
          }))),
        ]}
      />
      <PageHero
        eyebrow="성공사례"
        title="결과로 확인하는 울림컴퍼니의 실행력"
        description="선정, 유치, 낙찰, 입점처럼 기업의 다음 단계로 이어진 실제 성과를 분야별로 정리했습니다."
      />
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="Results"
            title="성과 유형별로 확인하세요"
            description="포트폴리오가 결과물의 완성도를 보여준다면, 성공사례는 실제 사업 성과와 맥락을 보여줍니다."
          />
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-2">
            {successMenus.map(({ href, icon: Icon, title, description }) => (
              <Link key={href} href={href} className="card card-hover h-full p-7">
                <Icon className="text-[var(--primary)]" size={30} />
                <h2 className="mt-6 text-2xl font-bold text-[#14100c]">{title}</h2>
                <p className="prose-muted mt-4 flex-1 text-sm">{description}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
                  성공사례 보기 <ArrowRight size={16} />
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
