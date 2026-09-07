import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Award,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Lightbulb,
  Quote,
  Presentation,
  TrendingUp,
} from "lucide-react";
import ClientMarquee from "@/components/ClientMarquee";
import ComparisonTable from "@/components/ComparisonTable";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import SectionHeader from "@/components/SectionHeader";
import { caseHighlights, commonFaqs, projects, services, trustSignals } from "@/data/content";
import { site, stats } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema, itemListSchema, newsArticleSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "울림컴퍼니",
  description:
    "울림컴퍼니는 경영컨설팅, 정부지원사업, 기업인증, 사업계획서, IR/PPT, 디자인 제작을 연결하는 비즈니스 성장 파트너입니다. 진입 2년 만에 지원사업 20억 이상 유치, 1,000건 이상 컨설팅 사례 보유.",
  alternates: { canonical: buildCanonical("/") },
};

export default function HomePage() {
  const brandPillars = [
    { label: "전략", Icon: Lightbulb },
    { label: "문서", Icon: FileCheck2 },
    { label: "발표", Icon: Presentation },
  ];

  const testimonials = [
    {
      badge: "반려동물 용품",
      name: "들OOO 대표",
      company: "예비창업패키지",
      result: "최종 선정",
      quote:
        "우리 업종이 가능한 지원사업을 먼저 찾아주고, 공고 기준에 맞춰 사업계획서 방향을 잡아주셔서 예비창업패키지 최종 선정까지 이어졌습니다.",
    },
    {
      badge: "예술단체",
      name: "여OOOO 대표",
      company: "지역 대표예술단체",
      result: "6억 규모",
      quote:
        "공고문을 봐도 어디부터 준비해야 할지 막막했는데, 예산 구성과 발표 흐름까지 정리해주셔서 큰 규모 사업에 선정될 수 있었습니다.",
    },
    {
      badge: "AI",
      name: "박OO 대표",
      company: "딥러닝 R&D",
      result: "R&D 선정",
      quote:
        "기술 설명에만 치우쳐 있던 계획서를 개발계획, 시장성, 사업화 가능성 중심으로 다시 정리해주셔서 R&D 선정까지 갈 수 있었습니다.",
    },
    {
      badge: "스포츠 용품",
      name: "이OO 대표",
      company: "청년창업사관학교",
      result: "최종 합격",
      quote:
        "아이템 장점만 쓰던 사업계획서를 평가자가 이해하는 구조로 바꿔주셔서 서류 통과 후 최종 합격까지 이어졌습니다.",
    },
    {
      badge: "차량관리",
      name: "김OO 대표",
      company: "예비창업패키지",
      result: "최우수",
      quote:
        "발표자료가 단순 회사소개서처럼 보였는데, 심사위원 질문 흐름에 맞춰 재구성해주셔서 발표평가에서 좋은 결과를 받았습니다.",
    },
    {
      badge: "커피 로스팅",
      name: "오O 대표",
      company: "부산TP R&D",
      result: "선정",
      quote:
        "정부지원사업은 제조나 기술기업만 가능하다고 생각했는데, 부산TP R&D에서 우리 브랜드에 맞는 항목을 찾아주시고 신청자료 방향을 정리해주셔서 선정될 수 있었습니다.",
    },
  ];

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }]),
          faqSchema(commonFaqs),
          itemListSchema(
            "울림컴퍼니 주요 프로젝트",
            projects.map((project) => ({
              title: project.title,
              description: project.note,
              href: "/portfolio",
            })),
          ),
          newsArticleSchema(),
        ]}
      />

      {/* HERO */}
      <section className="relative overflow-hidden bg-white">
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(90deg,#fff4ea_0%,#f8eee6_45%,#efe6df_100%)]" />
        <div className="absolute right-[-12rem] top-20 h-96 w-96 rounded-full bg-[rgba(235,104,38,0.15)] blur-3xl" />
        <div className="absolute left-[-10rem] bottom-10 h-80 w-80 rounded-full bg-[rgba(239,142,54,0.12)] blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-14 lg:grid-cols-[1fr_0.78fr] lg:items-center lg:px-8 lg:py-24">
          <div>
            <Link
              href={site.awardArticleUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#f1cdb9] bg-white/90 px-4 py-2 text-sm font-bold text-[var(--primary)] shadow-sm transition hover:-translate-y-0.5"
            >
              <Award size={17} />
              {site.award}
            </Link>
            <h1 className="section-title max-w-4xl text-4xl leading-[1.12] text-[#101511] lg:text-[3.5rem]">
              기업의 가능성을 성과로 연결하는 비즈니스 성장 파트너
            </h1>
            <p className="prose-muted mt-6 max-w-2xl text-lg">
              자금조달, 정부지원사업, 기업인증, 사업계획서, IR/PPT, 디자인 제작까지 — 기업 성장에 필요한
              전 과정을 한곳에서 설계합니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="btn-gradient inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-bold text-white"
              >
                상담 신청하기
                <ArrowRight size={17} />
              </Link>
              <Link
                href="/success/funding"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#ead5c7] bg-white/92 px-6 text-sm font-bold text-[#2d241d] shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                성공사례 보기
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="relative min-h-[520px] overflow-hidden rounded-3xl border border-[#e6d2c4] bg-[var(--deep)] shadow-2xl">
              <div className="absolute inset-0 bg-[url('/images/proof/plan-3.png')] bg-cover bg-center opacity-[0.16]" />
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(23,16,12,0.96)_0%,rgba(44,33,26,0.86)_48%,rgba(166,66,29,0.78)_100%)]" />
              <div className="absolute right-[-4rem] top-[-5rem] h-56 w-56 rounded-full bg-[#ef8e36]/30 blur-3xl" />
              <div className="absolute bottom-[-6rem] left-[-5rem] h-64 w-64 rounded-full bg-[#eb6826]/25 blur-3xl" />
              <div className="relative flex min-h-[520px] flex-col justify-between p-7">
                <div className="glass-panel floating-card ml-auto w-56 rounded-2xl border border-white/30 p-4 text-right">
                  <p className="text-xs font-bold text-[var(--primary)]">Growth Roadmap</p>
                  <p className="mt-2 text-lg font-bold text-[var(--deep)]">진단 → 전략 → 문서화</p>
                </div>

                <div className="grid gap-4">
                  <div className="floating-card max-w-sm rounded-2xl border border-white/15 bg-white/92 p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-[var(--primary)]">Business Plan</p>
                        <h2 className="mt-2 text-2xl font-bold text-[var(--deep)]">사업계획서·IR 전략 설계</h2>
                      </div>
                      <FileCheck2 className="shrink-0 text-[var(--primary)]" size={32} />
                    </div>
                    <div className="mt-5 h-2 rounded-full bg-[#f2dfd0]">
                      <div className="h-2 w-[76%] rounded-full bg-[linear-gradient(90deg,#ef8e36,#eb6826)]" />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {brandPillars.map(({ label, Icon }) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/15 bg-white/12 p-4 text-white shadow-lg backdrop-blur"
                      >
                        <Icon size={20} className="text-[#ef8e36]" />
                        <p className="mt-3 text-sm font-bold">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="glass-panel floating-card rounded-2xl border border-white/25 p-5">
                    <TrendingUp className="text-[var(--primary)]" size={24} />
                    <p className="mt-4 text-3xl font-bold text-[var(--deep)]">20억+</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">지원사업 유치 사례</p>
                  </div>
                  <div className="glass-panel floating-card rounded-2xl border border-white/25 p-5">
                    <BarChart3 className="text-[var(--primary)]" size={24} />
                    <p className="mt-4 text-3xl font-bold text-[var(--deep)]">1,000+</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">실제 컨설팅 사례</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-y border-[var(--line)] bg-[linear-gradient(135deg,#fff4ea,#f8ede4)]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-5 py-10 lg:grid-cols-4 lg:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="px-4 text-center lg:text-left">
              <p className="text-4xl font-bold text-[var(--primary)]">{stat.value}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CLIENTS */}
      <ClientMarquee />

      {/* SERVICES */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="사업영역"
            title="성장 단계에 맞춘 맞춤 서비스"
            description="문서 하나, 디자인 하나만 보는 것이 아니라 기업의 상황과 목적을 먼저 읽고 필요한 실행 순서를 함께 정리합니다."
          />
          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = service.icon;
              return (
                <Link key={service.href} href={service.href} className="card card-hover h-full p-7">
                  <Icon className="mb-7 text-[var(--primary)]" size={30} />
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
                    {service.eyebrow}
                  </p>
                  <h3 className="text-2xl font-bold text-[#14100c]">{service.title}</h3>
                  <p className="prose-muted mt-4 flex-1 text-sm">{service.summary}</p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
                    자세히 보기 <ArrowRight size={16} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* RESULTS */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="성과"
            title="숫자로 증명하는 성과"
            description="창업 2년 만에 지원사업 누적 20억 원 이상 유치. 실제 기업과 함께 만든 결과입니다."
            linkHref="/success/funding"
            linkLabel="전체 사례 보기"
          />
          <div className="mt-10 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {caseHighlights.map((item) => {
              const Icon = item.icon ?? TrendingUp;
              return (
                <article key={item.title} className="card h-full p-6">
                  <Icon className="text-[var(--primary)]" size={26} />
                  <p className="mt-5 text-xs font-bold text-[var(--accent)]">{item.category}</p>
                  <h3 className="mt-2 text-lg font-bold leading-7 text-[#14100c]">{item.title}</h3>
                  <p className="mt-4 text-2xl font-bold text-[var(--primary)]">{item.result}</p>
                  <p className="prose-muted mt-3 flex-1 text-sm">{item.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="bg-[linear-gradient(180deg,#fffaf6_0%,#fff4ea_100%)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="고객 후기"
            title="선정된 대표님들이 말한 울림컴퍼니의 차이"
            description="결과를 만든 대표님들은 울림컴퍼니의 차이를 이렇게 말했습니다."
          />
          <div className="mt-10 grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
            {testimonials.map((item) => (
              <article
                key={`${item.name}-${item.company}`}
                className="card h-full p-6 shadow-[0_18px_45px_rgba(120,67,33,0.08)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff8a2a,#ef5d1b)] px-2 text-center text-[11px] font-black leading-tight text-white shadow-[0_12px_28px_rgba(239,93,27,0.24)]">
                      {item.badge}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#14100c]">{item.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">{item.company}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#fff1e8] px-3 py-1 text-xs font-black text-[var(--primary)]">
                    {item.result}
                  </span>
                </div>
                <div className="mt-6 rounded-2xl bg-[#fff7f1] p-5">
                  <Quote className="mb-4 text-[var(--primary)]" size={22} />
                  <p className="text-[17px] font-bold leading-8 text-[#14100c]">
                    {item.quote}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-6 text-center text-xs leading-6 text-[var(--muted)]">
            개인정보 보호를 위해 이름과 일부 표현은 익명 처리했습니다.
          </p>
        </div>
      </section>

      {/* WHY WOOLIM (비교) */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="울림의 차별점"
            title="왜 울림컴퍼니인가"
            description="단일 과제 해결이 아니라, 기업 성장 단계 전체를 함께 봅니다. 서류부터 디자인까지 내부 팀이 직접 진행합니다."
          />
          <div className="mt-10">
            <ComparisonTable />
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="bg-[var(--deep)] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-[0.8fr_1fr] lg:px-8 lg:py-24">
          <div>
            <span className="eyebrow eyebrow--light">신뢰</span>
            <h2 className="section-title mt-4 text-3xl lg:text-4xl">성과로 증명하는 컨설팅</h2>
            <p className="mt-5 text-base leading-8 text-white/65">
              울림컴퍼니는 국가공인 경영지도사인 대표의 전문성과 실제 프로젝트 경험을 바탕으로 기업의 성장
              로드맵을 제안합니다.
            </p>
            <Link
              href="/about"
              className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#ef8e36]"
            >
              회사소개 보기 <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid gap-3">
            {trustSignals.map((signal) => (
              <div key={signal} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--accent)]" size={19} />
                <p className="text-sm leading-6 text-white/80">{signal}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEWS */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader eyebrow="인사이트" title="소식과 칼럼" linkHref="/news" linkLabel="인사이트 보기" />
          <article className="card mt-9 p-7 lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-bold text-[var(--accent)]">2026.06.23 · 공감신문</p>
              <h3 className="mt-2 text-2xl font-bold text-[#14100c]">{site.award}</h3>
              <p className="prose-muted mt-3 max-w-3xl text-sm">
                전문성과 고객 중심 서비스 역량을 인정받아 경영컨설팅 부문 수상 브랜드로 이름을 올렸습니다.
              </p>
            </div>
            <a
              href={site.awardArticleUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-5 text-sm font-bold lg:mt-0"
            >
              기사 보기 <ExternalLink size={16} />
            </a>
          </article>
        </div>
      </section>

      <FaqList faqs={commonFaqs} />
      <ContactBand />
    </>
  );
}
