import Image from "next/image";
import type { Metadata } from "next";
import {
  BadgeCheck,
  Banknote,
  Car,
  Clock,
  FileText,
  Landmark,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Printer,
  TrainFront,
} from "lucide-react";
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

const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(site.address)}&hl=ko&z=17&output=embed`;

const contactInfo = [
  { icon: MapPin, label: "주소", value: site.address },
  { icon: Phone, label: "대표번호", value: site.phone, href: `tel:${site.phone.replaceAll("-", "")}` },
  { icon: Printer, label: "팩스", value: site.fax },
  { icon: Mail, label: "이메일", value: site.email, href: `mailto:${site.email}` },
  { icon: Clock, label: "운영시간", value: `${site.businessHours} (${site.closedDays} 휴무)` },
  { icon: MessageCircle, label: "카카오톡 채널", value: "채널로 바로 문의하기", href: site.kakaoUrl },
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
            <div className="relative flex min-h-[560px] overflow-hidden rounded-3xl border border-[#ead6c9] bg-[var(--deep)] shadow-[var(--shadow-card)]">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(29,22,18,0.98)_0%,rgba(61,42,31,0.92)_48%,rgba(178,73,31,0.84)_100%)]" />
              <div className="absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-[#ef8e36]/25 blur-3xl" />
              <div className="absolute bottom-[-7rem] left-[-6rem] h-80 w-80 rounded-full bg-[#eb6826]/20 blur-3xl" />
              <div className="relative flex w-full flex-col items-center justify-center px-8 py-14 text-center">
              <Image
                  src="/images/woolim-logo-cropped.png"
                  alt={`${site.name} 로고`}
                  width={520}
                  height={360}
                  className="h-auto w-full max-w-[340px] drop-shadow-[0_24px_45px_rgba(0,0,0,0.22)]"
                priority
              />
                <p className="mt-8 text-sm font-bold text-[#f4aa67]">WOOLIM COMPANY</p>
                <p className="mt-3 max-w-sm text-2xl font-bold leading-snug text-white">
                  기업의 가능성을 성과로 연결합니다
                </p>
              </div>
            </div>
            <div className="absolute bottom-5 left-5 rounded-2xl bg-white/92 px-5 py-4 shadow-xl backdrop-blur">
              <p className="text-sm font-bold text-[var(--primary)]">{site.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Business Growth Partner</p>
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

      <section id="location" className="scroll-mt-24 bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="오시는 길"
            title="울림컴퍼니 위치"
            description="방문 상담은 전화 또는 카카오톡 채널로 일정을 먼저 문의해 주세요."
          />
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
              <iframe
                title="울림컴퍼니 위치"
                src={mapSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-[360px] w-full lg:h-full lg:min-h-[460px]"
              />
            </div>

            <div className="grid content-start gap-3">
              {contactInfo.map(({ icon: Icon, label, value, href }) => (
                <div key={label} className="card flex-row items-start gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
                    {href ? (
                      <a
                        href={href}
                        target={href.startsWith("http") ? "_blank" : undefined}
                        rel={href.startsWith("http") ? "noreferrer" : undefined}
                        className="mt-1 block text-sm font-semibold text-[#2d241d] hover:text-[var(--primary)]"
                      >
                        {value}
                      </a>
                    ) : (
                      <p className="mt-1 text-sm font-semibold text-[#2d241d]">{value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-9 grid items-stretch gap-4 lg:grid-cols-2">
            <article className="card h-full p-7">
              <div className="flex items-center gap-3">
                <TrainFront className="text-[var(--primary)]" size={24} />
                <h3 className="text-lg font-bold text-[#14100c]">대중교통 이용 시</h3>
              </div>
              <p className="prose-muted mt-4 text-sm">{site.directions.transit}</p>
              <p className="mt-3 text-xs font-semibold text-[var(--accent)]">{site.directions.note}</p>
            </article>
            <article className="card h-full p-7">
              <div className="flex items-center gap-3">
                <Car className="text-[var(--primary)]" size={24} />
                <h3 className="text-lg font-bold text-[#14100c]">자가용 이용 시</h3>
              </div>
              <p className="prose-muted mt-4 text-sm">{site.directions.parking}</p>
            </article>
          </div>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
