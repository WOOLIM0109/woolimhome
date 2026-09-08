import type { Metadata } from "next";
import { FileCheck2, Presentation, Search, Target } from "lucide-react";
import BiddingCaseTabs from "@/components/BiddingCaseTabs";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { pptCases } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "성공사례 | 입찰/입점",
  description:
    "울림컴퍼니가 입찰서류와 발표자료를 기획·디자인해 만든 공공조달 12억 원 낙찰, 백화점·플랫폼 입점 등 실제 성공사례를 소개합니다.",
  alternates: { canonical: buildCanonical("/success/bidding-entry") },
};

const summary = [
  { value: "12억", label: "단일 공공조달 최대 낙찰" },
  { value: "10건", label: "홈페이지 공개 성공사례" },
  { value: "3개", label: "공공조달·입점·수상 분야" },
];

const workingProcess = [
  {
    icon: Search,
    step: "01",
    title: "평가항목 분석",
    description: "공고문과 평가표를 기준으로 반드시 답해야 할 질문을 찾습니다.",
  },
  {
    icon: Target,
    step: "02",
    title: "핵심 논리 설계",
    description: "기업의 강점과 실행계획을 평가자의 관점에서 한 흐름으로 정리합니다.",
  },
  {
    icon: FileCheck2,
    step: "03",
    title: "서류·PPT 완성",
    description: "내용 구조와 시각 디자인을 하나의 설득 흐름으로 완성합니다.",
  },
  {
    icon: Presentation,
    step: "04",
    title: "발표 대응",
    description: "발표 순서와 핵심 메시지를 정리해 실제 평가 상황까지 준비합니다.",
  },
];

export default function BiddingEntrySuccessPage() {
  const allItems = pptCases.flatMap((group) => group.items);
  const featuredCase = pptCases[0].items[0];
  const groups = pptCases.map(({ slug, group, items }) => ({ slug, group, items }));

  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "성공사례", href: "/success" },
            { name: "입찰/입점", href: "/success/bidding-entry" },
          ]),
          itemListSchema(
            "입찰·입점 성공사례",
            pptCases.flatMap((group) =>
              group.items.map((item) => ({
                title: item.company + " · " + item.title,
                description:
                  "기업 과제: " + item.challenge + " 울림 수행: " + item.approach + " 성과: " + item.result,
                href: "/success/bidding-entry#case-" + item.slug,
              })),
            ),
          ),
        ]}
      />

      <PageHero
        eyebrow="성공사례"
        title="입찰·입점 성공사례"
        description="평가 기준과 청중의 관점을 분석해 제안 논리, 서류, 발표자료를 하나의 흐름으로 설계한 실제 성과입니다."
      />

      <section className="border-b border-[var(--line)] bg-[#edf2ef]" aria-label="입찰·입점 성과 요약">
        <div className="mx-auto grid max-w-7xl sm:grid-cols-3">
          {summary.map((item, index) => (
            <div
              key={item.label}
              className={
                index
                  ? "border-t border-[var(--line)] px-5 py-8 text-center sm:border-l sm:border-t-0 sm:px-7 sm:text-left lg:py-10"
                  : "px-5 py-8 text-center sm:px-7 sm:text-left lg:py-10"
              }
            >
              <p className="text-4xl font-black text-[#1f6454] lg:text-5xl">{item.value}</p>
              <p className="mt-2 text-sm font-semibold text-[#4b5e57]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="대표 사례"
            title="평가표의 항목을 설득력 있는 제안으로"
            description="가장 큰 낙찰 성과를 기업의 과제와 울림컴퍼니의 실제 수행 범위까지 함께 보여드립니다."
          />

          <article
            id={"case-" + featuredCase.slug}
            className="mt-10 scroll-mt-28 overflow-hidden rounded-lg bg-[#17362f] text-white shadow-[0_26px_64px_rgba(19,53,45,0.2)]"
          >
            <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.65fr)]">
              <div className="p-6 sm:p-9 lg:p-12">
                <p className="text-xs font-bold text-[#8ed2c1]">FEATURED CASE · {featuredCase.company}</p>
                <h2 className="mt-4 max-w-3xl text-3xl font-black leading-[1.25] sm:text-4xl lg:text-[2.8rem]">
                  {featuredCase.title}
                </h2>
                <dl className="mt-9 divide-y divide-white/12 border-y border-white/12">
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-xs font-bold text-[#8ed2c1]">기업 과제</dt>
                    <dd className="text-sm leading-7 text-white/82">{featuredCase.challenge}</dd>
                  </div>
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-xs font-bold text-[#8ed2c1]">울림 수행</dt>
                    <dd className="text-sm leading-7 text-white/82">{featuredCase.approach}</dd>
                  </div>
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-xs font-bold text-[#8ed2c1]">최종 성과</dt>
                    <dd className="text-sm font-bold leading-7 text-white">{featuredCase.result}</dd>
                  </div>
                </dl>
              </div>

              <aside className="flex flex-col justify-center border-t border-white/12 bg-[#102a24] p-6 sm:p-9 lg:border-l lg:border-t-0 lg:p-10">
                <p className="text-xs font-bold text-white/55">서울 공공서비스 용역</p>
                <p className="mt-3 whitespace-nowrap text-5xl font-black leading-tight text-[#ff8a45]">{featuredCase.result}</p>
                <p className="mt-5 text-sm leading-7 text-white/65">
                  제안 논리와 서류, 발표자료의 시각 체계를 하나로 연결해 평가자가 핵심을 빠르게 이해하도록 구성했습니다.
                </p>
              </aside>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-[#f6f4f1]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="분야별 사례"
            title="목적에 따라 찾아보는 10개의 성과"
            description="공공조달 입찰, 입점·제휴, 대회·수상 사례를 같은 정보 기준으로 비교할 수 있습니다."
            linkHref="/portfolio/ppt"
            linkLabel="PPT 포트폴리오 보기"
          />
          <div className="mt-10">
            <BiddingCaseTabs groups={groups} />
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader
            eyebrow="진행 방식"
            title="분석부터 발표까지 한 흐름으로"
            description="예쁜 문서를 만드는 데서 멈추지 않고 평가와 의사결정의 순간까지 고려합니다."
          />
          <ol className="mt-10 grid border-y border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
            {workingProcess.map((item, index) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.step}
                  className={
                    index
                      ? "border-t border-[var(--line)] py-7 sm:border-l sm:border-t-0 sm:px-6 lg:py-8"
                      : "py-7 sm:px-6 lg:py-8"
                  }
                >
                  <div className="flex items-center justify-between">
                    <Icon size={24} className="text-[#1f6454]" aria-hidden="true" />
                    <span className="text-xs font-black text-[#9a8d83]">{item.step}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-black text-[#211811]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{item.description}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 text-center text-xs leading-6 text-[var(--muted)]">
            공개 사례 {allItems.length}건은 고객사 보호를 위해 업종형 익명명으로 표기했습니다.
          </p>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
