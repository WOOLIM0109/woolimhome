import type { Metadata } from "next";
import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { consultingCases } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "성공사례 | 정부지원사업/정책자금",
  description:
    "울림컴퍼니의 정부지원사업·정책자금·R&D 컨설팅 주요 성과 — TIPS 8억, 디딤돌 2억 등 실제 선정 사례를 소개합니다.",
  alternates: { canonical: buildCanonical("/success/funding") },
};

const summary = [
  { value: "20억+", label: "진입 2년 만에 유치한 지원사업" },
  { value: "1,000+", label: "보유한 실제 컨설팅 사례" },
  { value: "8억", label: "단일 과제 최대 선정 (TIPS R&D)" },
];

export default function FundingSuccessPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "성공사례", href: "/success" },
            { name: "정부지원사업/정책자금", href: "/success/funding" },
          ]),
          itemListSchema(
            "정부지원사업/정책자금 성공사례",
            consultingCases.map((item) => ({
              title: `${item.field} - ${item.headline}`,
              description: item.wins.join(", "),
              href: "/success/funding",
            })),
          ),
        ]}
      />
      <PageHero
        eyebrow="성공사례"
        title="정부지원사업/정책자금 선정 성과"
        description="정부지원사업·R&D·사업계획서·정책자금 방향 설계를 통해 실제 선정·유치로 이어진 사례입니다."
      />

      <section className="border-b border-[var(--line)] bg-[var(--surface-strong)]">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-px px-5 py-10 sm:grid-cols-3 lg:px-8">
          {summary.map((item) => (
            <div key={item.label} className="px-4 text-center sm:text-left">
              <p className="text-4xl font-bold text-[var(--primary)]">{item.value}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="주요 사례"
            title="기업과 함께 만든 선정 성과"
            description="기업 정보 보호를 위해 사명은 이니셜로 표기합니다."
          />
          <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-2">
            {consultingCases.map((item) => (
              <article key={item.company} className="card h-full overflow-hidden p-0">
                <div className="grid sm:grid-cols-[0.85fr_1fr]">
                  <div className="relative aspect-[3/4] w-full bg-[var(--surface-strong)] sm:aspect-auto">
                    <Image
                      src={item.image}
                      alt={`${item.field} 사업계획서 사례`}
                      fill
                      sizes="(max-width:640px) 100vw, 30vw"
                      className="object-cover object-top"
                    />
                  </div>
                  <div className="flex flex-col p-6">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold text-[var(--primary)]">
                        {item.company}
                      </span>
                      <span className="text-2xl font-bold text-[var(--primary)]">{item.headline}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold leading-7 text-[#14100c]">{item.field}</h3>
                    <ul className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
                      {item.wins.map((win) => (
                        <li key={win} className="flex gap-2 text-sm leading-6 text-[#2d241d]">
                          <CheckCircle2 size={15} className="mt-1 shrink-0 text-[var(--primary)]" />
                          {win}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-8 text-center text-sm font-semibold text-[var(--muted)]">
            이외에도 약 1,000건 이상의 실제 컨설팅 사례를 보유하고 있습니다.
          </p>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
