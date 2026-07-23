import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowRight, BadgeCheck, Banknote, FileText, Landmark } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { ceo, trustSignals } from "@/data/content";
import { site } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema } from "@/lib/schema";

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

export default function AboutPage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: "홈", href: "/" }, { name: "회사소개", href: "/about" }])} />
      <PageHero
        eyebrow="회사소개"
        title="기업의 성장이 곧 우리의 성장이라는 믿음"
        description="울림컴퍼니는 기업이 가진 가능성이 실제 성과로 이어질 수 있도록 전략과 실행, 문서와 디자인을 연결합니다."
      />

      {/* 대표 인사말 */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-[0.85fr_1fr] lg:px-8 lg:py-24">
          <div className="relative">
            <div className="relative overflow-hidden rounded-3xl border border-[var(--line)] shadow-[var(--shadow-card)]">
              <Image
                src={ceo.photo}
                alt={`${ceo.name} ${site.name} 대표`}
                width={815}
                height={1019}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <div className="absolute bottom-5 left-5 rounded-2xl bg-white/92 px-5 py-4 shadow-xl backdrop-blur">
              <p className="text-sm font-bold text-[var(--primary)]">{ceo.name} 대표</p>
              <p className="mt-1 text-xs text-[var(--muted)]">국가공인 경영지도사 33기</p>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <span className="eyebrow">대표 인사말</span>
            <h2 className="section-title mt-4 text-3xl">기업의 강점이 제대로 전달되도록 함께합니다</h2>
            <div className="mt-6 space-y-4 text-base leading-8 text-[var(--muted)]">
              {ceo.greeting.map((p) => (
                <p key={p.slice(0, 12)}>{p}</p>
              ))}
            </div>
            <Link href="/about/ceo" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
              대표 약력 자세히 보기 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* 4대 서비스 구조 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="서비스 구성"
            title="성장 단계에 필요한 모든 과정을 한곳에서"
            description="울림컴퍼니는 자금조달, 기업인증, 정부지원사업, 비즈니스 문서 기획·디자인까지 기업 성장에 필요한 맞춤형 컨설팅을 제공합니다."
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map(({ icon: Icon, title, desc }) => (
              <article key={title} className="card h-full p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Icon size={24} />
                </div>
                <h3 className="mt-5 text-lg font-bold text-[#14100c]">{title}</h3>
                <p className="prose-muted mt-3 flex-1 text-sm">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 신뢰 근거 */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader eyebrow="전문성" title="검증된 전문성" />
          <div className="mt-9 grid gap-3 sm:grid-cols-2">
            {trustSignals.map((item) => (
              <div key={item} className="card flex-row items-center gap-3 p-5">
                <BadgeCheck size={20} className="shrink-0 text-[var(--primary)]" />
                <span className="text-sm font-semibold text-[#2d241d]">{item}</span>
              </div>
            ))}
            <div className="card flex-row items-center gap-3 bg-[var(--accent-soft)] p-5 sm:col-span-2">
              <BadgeCheck size={20} className="shrink-0 text-[var(--primary)]" />
              <span className="text-sm font-bold text-[#6a4a12]">{site.award}</span>
            </div>
          </div>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
