import styles from "@/components/PortfolioSuccess.module.css";
import type { Metadata } from "next";
import { CheckCircle2, FileText, Route, Target } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import SuccessEvidenceDialog from "@/components/SuccessEvidenceDialog";
import { consultingCases } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "성공사례 | 정부지원사업/정책자금",
  description:
    "울림컴퍼니가 사업 단계 진단과 계획서 전략을 통해 TIPS R&D 8억 원 등 실제 선정으로 연결한 정부지원사업·정책자금 성공사례를 소개합니다.",
  alternates: { canonical: buildCanonical("/success/funding") },
};

const summary = [
  { value: "20억+", label: "사업 진입 2년 내 누적 유치" },
  { value: "1,000+", label: "보유 컨설팅 사례" },
  { value: "8억", label: "단일 과제 최대 선정" },
];

const process = [
  { icon: Target, step: "01", title: "기업 상황 진단", description: "성장 단계, 자금 목적, 준비 수준을 먼저 확인합니다." },
  { icon: Route, step: "02", title: "사업 로드맵 설계", description: "현재 과제와 다음 지원사업이 이어지도록 순서를 잡습니다." },
  { icon: FileText, step: "03", title: "문서·발표 구조화", description: "평가 기준에 맞춰 계획서와 발표자료의 논리를 정리합니다." },
];

export default function FundingSuccessPage() {
  const [featuredCase, ...otherCases] = consultingCases;

  return (
    <div className={styles.page}>
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
              title: `${item.company} · ${item.title}`,
              description: `기업 과제: ${item.challenge} 울림 수행: ${item.approach} 성과: ${item.wins.join(", ")}`,
              href: `/success/funding#case-${item.slug}`,
            })),
          ),
        ]}
      />

      <PageHero
        eyebrow="성공사례"
        title="정부지원사업·정책자금 선정 성과"
        description="기업의 성장 단계와 과제 목적을 진단하고 사업계획서, R&D 전략, 발표자료를 연결해 실제 선정으로 이어진 사례입니다."
      />

      <section className="border-b border-[var(--line)] bg-[#f6f6f4]" aria-label="정부지원사업 성과 요약">
        <div className={styles.summaryGrid}>
          {summary.map((item, index) => (
            <div
              key={item.label}
              className={`px-5 py-8 text-center sm:px-7 sm:text-left lg:py-10 ${index ? "border-t border-[var(--line)] sm:border-l sm:border-t-0" : ""}`}
            >
              <p className={styles.summaryNumber}>{item.value}</p>
              <p className="mt-2 text-base lg:text-[17px] font-semibold text-[#666666]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="대표 사례"
            title="한 번의 선정이 다음 성장으로 이어지도록"
            description="가장 큰 숫자만 보여주는 대신 기업의 상황, 울림컴퍼니의 수행, 연결된 성과를 함께 공개합니다."
          />

          <article
            id={`case-${featuredCase.slug}`}
            className={styles.featured}
          >
            <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.65fr)]">
              <div className="p-6 sm:p-9 lg:p-12">
                <p className="text-[14px] font-bold text-[#eb6826]">FEATURED CASE · {featuredCase.company}</p>
                <h2 className="mt-4 max-w-3xl text-3xl font-bold leading-[1.25] sm:text-4xl lg:text-[2.8rem]">
                  {featuredCase.title}
                </h2>
                <p className="mt-5 max-w-2xl text-base lg:text-[18px] leading-8 text-[#555555]">{featuredCase.field}</p>

                <dl className="mt-9 divide-y divide-[#dededb] border-y border-[#dededb]">
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-[14px] font-bold text-[#eb6826]">기업 상황</dt>
                    <dd className="text-base lg:text-[17px] leading-7 text-[#555555]">{featuredCase.challenge}</dd>
                  </div>
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-[14px] font-bold text-[#eb6826]">울림 수행</dt>
                    <dd className="text-base lg:text-[17px] leading-7 text-[#555555]">{featuredCase.approach}</dd>
                  </div>
                  <div className="grid gap-2 py-5 sm:grid-cols-[110px_1fr]">
                    <dt className="text-[14px] font-bold text-[#eb6826]">연결 성과</dt>
                    <dd className="text-base lg:text-[17px] font-bold leading-7 text-[#555555]">{featuredCase.resultSummary}</dd>
                  </div>
                </dl>
              </div>

              <aside className={styles.featuredAside}>
                <div>
                  <p className="text-[14px] font-bold text-[#555555]">대표 선정 성과</p>
                  <p className="mt-3 text-5xl font-bold text-[#eb6826] lg:text-6xl">{featuredCase.headline}</p>
                  <p className="mt-4 text-lg font-bold leading-7">TIPS 기술창업지원<br />최종 선정</p>
                  <p className="mt-5 text-base lg:text-[17px] leading-7 text-[#555555]">
                    단일 성과뿐 아니라 초기 사업화부터 R&D, 수출까지 후속 과제를 연결했습니다.
                  </p>
                </div>
                <div className="mt-8">
                  <SuccessEvidenceDialog
                    slug={featuredCase.slug}
                    company={featuredCase.company}
                    title={featuredCase.title}
                    wins={featuredCase.wins}
                    evidenceNotice={featuredCase.evidenceNotice}
                    tone="light"
                  />
                </div>
              </aside>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="분야별 사례"
            title="같은 기준으로 비교하는 선정 성과"
            description="모든 사례를 기업 과제, 울림 수행, 최종 성과의 순서로 정리했습니다."
          />

          <div className={styles.caseGrid}>
            {otherCases.map((item) => (
              <article
                id={`case-${item.slug}`}
                key={item.slug}
                className={styles.case}
              >
                <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
                  <div>
                    <p className="text-[14px] font-bold text-[#eb6826]">{item.category}</p>
                    <p className="mt-1 text-base lg:text-[17px] font-bold text-[#555555]">{item.company}</p>
                  </div>
                  <p className="shrink-0 text-xl font-bold text-[#eb6826]">{item.headline}</p>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-xl font-bold leading-8 text-[#171717]">{item.title}</h3>
                  <dl className="mt-6 flex-1 space-y-5">
                    <div>
                      <dt className="text-[14px] font-bold text-[#777777]">기업 과제</dt>
                      <dd className="mt-2 text-base lg:text-[17px] leading-7 text-[var(--muted)]">{item.challenge}</dd>
                    </div>
                    <div>
                      <dt className="text-[14px] font-bold text-[#777777]">울림 수행</dt>
                      <dd className="mt-2 text-base lg:text-[17px] leading-7 text-[var(--muted)]">{item.approach}</dd>
                    </div>
                  </dl>
                  <div className="mt-6 border-t border-[var(--line)] pt-5">
                    <p className="flex gap-2 text-base lg:text-[17px] font-bold leading-6 text-[#333333]">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-[#eb6826]" size={17} aria-hidden="true" />
                      {item.resultSummary}
                    </p>
                    <div className="mt-5">
                      <SuccessEvidenceDialog
                        slug={item.slug}
                        company={item.company}
                        title={item.title}
                        wins={item.wins}
                        image={item.evidencePublic ? item.image : undefined}
                        imageAlt={`${item.company} 정부지원사업 공개 자료 일부`}
                        evidenceNotice={item.evidenceNotice}
                      />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-8 text-center text-base lg:text-[17px] leading-7 text-[var(--muted)]">
            기업 보호를 위해 고객사명은 업종형으로 표기하고, 기존 공개 범위의 성과 내역만 제공합니다.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="수행 방식"
            title="선정 가능성을 문서 한 장이 아닌 과정으로 만듭니다"
            description="과제 탐색부터 문서와 발표까지 한 흐름으로 연결합니다."
          />
          <div className="mt-10 grid border-y border-[var(--line)] md:grid-cols-3">
            {process.map(({ icon: Icon, step, title, description }, index) => (
              <div key={step} className={`py-7 md:px-7 ${index ? "border-t border-[var(--line)] md:border-l md:border-t-0" : ""}`}>
                <div className="flex items-center gap-3">
                  <Icon size={21} className="text-[#eb6826]" aria-hidden="true" />
                  <span className="text-[14px] font-bold text-[#777777]">{step}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#171717]">{title}</h3>
                <p className="mt-3 text-base lg:text-[17px] leading-7 text-[var(--muted)]">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ContactBand />
    </div>
  );
}