import Image from "next/image";
import type { Metadata } from "next";
import { BadgeCheck, Quote } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { ceo } from "@/data/content";
import { site } from "@/data/site";
import { SITE_URL, buildCanonical, toAbsoluteUrl } from "@/lib/site-config";
import { breadcrumbSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "대표 소개",
  description: `${site.name} 대표 ${ceo.name} — 국가공인 경영지도사 33기, 중기부 비즈니스지원단 클리닉 위원. 기업 성장을 위한 맞춤 컨설팅을 제공합니다.`,
  alternates: { canonical: buildCanonical("/about/ceo") },
};

function personSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: ceo.name,
    jobTitle: "국가공인 경영지도사 / 울림컴퍼니 대표",
    worksFor: { "@id": `${SITE_URL}/#organization` },
    image: toAbsoluteUrl(ceo.photo),
    knowsAbout: ["경영컨설팅", "정부지원사업", "기업인증", "사업계획서", "IR 자료"],
    description: ceo.credentials.join(", "),
  };
}

export default function CeoPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "회사소개", href: "/about" },
            { name: "대표 소개", href: "/about/ceo" },
          ]),
          personSchema(),
        ]}
      />
      <PageHero
        eyebrow="대표 소개"
        title="기업의 가능성을 함께 키우는 파트너"
        description="대표가 직접 찾아뵙고, 사업 성장을 위한 로드맵을 제안합니다."
      />

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-[0.8fr_1fr] lg:px-8 lg:py-24">
          <div className="space-y-5">
            <div className="overflow-hidden rounded-3xl border border-[var(--line)] shadow-[var(--shadow-card)]">
              <Image
                src={ceo.photo}
                alt={`${ceo.name} ${site.name} 대표`}
                width={815}
                height={1019}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-6">
              <p className="text-lg font-bold text-[#14100c]">{ceo.name}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{ceo.title}</p>
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <Quote className="text-[var(--primary)]" size={36} />
            <div className="mt-5 space-y-4 text-base leading-8 text-[var(--muted)]">
              {ceo.greeting.map((p) => (
                <p key={p.slice(0, 12)}>{p}</p>
              ))}
            </div>
            <p className="mt-6 text-sm font-bold text-[#14100c]">— {site.name} 대표 {ceo.name}</p>
          </div>
        </div>
      </section>

      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader eyebrow="약력" title="주요 약력" />
          <div className="mt-9 grid gap-3 sm:grid-cols-2">
            {ceo.credentials.map((item) => (
              <div key={item} className="card flex-row items-center gap-3 p-5">
                <BadgeCheck size={20} className="shrink-0 text-[var(--primary)]" />
                <span className="text-sm font-semibold text-[#2d241d]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
