import { getSuccessMetrics } from "@/data/success-metrics";
import styles from "@/components/PortfolioSuccess.module.css";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, Gavel, Landmark } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "성공사례",
  description:
    "울림컴퍼니가 함께 만든 정부지원사업·정책자금 선정, 공공조달 낙찰, 백화점·플랫폼 입점 성공사례를 과정과 성과 중심으로 소개합니다.",
  alternates: { canonical: buildCanonical("/success") },
};


const successTracks = (metrics: Awaited<ReturnType<typeof getSuccessMetrics>>) => [
  {
    href: "/success/funding",
    icon: Landmark,
    eyebrow: "정부지원사업·정책자금",
    title: "기업의 성장 단계에 맞는 과제를 연결합니다",
    description:
      "사업화, R&D, 정책자금의 목적을 구분하고 기업 상황에 맞는 로드맵과 평가 문서를 설계합니다.",
    result: `${metrics.summary.largestGrant.value} 원`,
    resultLabel: "TIPS R&D 단일 과제 최대 선정",
    points: [
      "AI 플랫폼 스타트업 지원사업·투자 연계",
      `${metrics.funding.count}건의 정부지원사업 최종 선정`,
      "문화예술 지원사업 최종 선정",
    ],
    accent: "orange",
  },
  {
    href: "/success/bidding-entry",
    icon: Gavel,
    eyebrow: "입찰·입점",
    title: "평가항목을 읽히는 제안 논리로 바꿉니다",
    description:
      "입찰서류, 입점 제안서, 발표자료의 메시지와 시각 체계를 한 흐름으로 구성해 의사결정을 돕습니다.",
    result: `${metrics.summary.largestBid.value} 원`,
    resultLabel: "CJ올리브네트웍스 SI 용역 낙찰",
    points: [
      `입찰 낙찰 사례 ${metrics.bidding.count}건`,
      "더현대·CJ온스타일·카카오 입점·제휴",
      "발표 코칭 포함 대회·수상 사례 2건",
    ],
    accent: "green",
  },
];

const representativeResults = (metrics: Awaited<ReturnType<typeof getSuccessMetrics>>) => [
  {
    title: "AI 플랫폼 스타트업 TIPS R&D 선정",
    description: `사업화부터 투자와 R&D까지 연결해 TIPS ${metrics.summary.largestGrant.value} 원 선정`,
    href: "/success/funding#case-ai-platform-tips",
  },
  {
    title: "CJ올리브네트웍스 SI 용역 낙찰",
    description: `입찰서류와 발표자료 기획·디자인으로 ${metrics.summary.largestBid.value} 원 낙찰`,
    href: "/success/bidding-entry#case-cj-si",
  },
  {
    title: "백화점·플랫폼 입점 및 제휴",
    description: "더현대 팝업스토어, CJ온스타일, 카카오톡 선물하기 제안 성과",
    href: "/success/bidding-entry",
  },
];

export default async function SuccessPage() {
  const metrics = await getSuccessMetrics();
  const summary = [metrics.summary.total, metrics.summary.largestBid, metrics.summary.production];
  return (
    <div className={styles.page}>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "성공사례", href: "/success" }]),
          itemListSchema("울림컴퍼니 대표 성공사례", representativeResults(metrics)),
        ]}
      />

      <PageHero
        eyebrow="성공사례"
        title="결과만이 아니라, 결과를 만든 과정을 보여드립니다"
        description="기업의 상황을 진단하고 전략, 문서, 발표를 연결해 선정·유치·낙찰·입점으로 이어진 실제 사례입니다."
      />

      <section className="border-b border-[var(--line)] bg-[#f6f6f4]" aria-label="울림컴퍼니 대표 성과">
        <div className={styles.summaryGrid}>
          {summary.map((item, index) => (
            <div
              key={item.label}
              className={
                index
                  ? "border-t border-[var(--line)] px-5 py-8 text-center sm:border-l sm:border-t-0 sm:px-7 sm:text-left lg:py-10"
                  : "px-5 py-8 text-center sm:px-7 sm:text-left lg:py-10"
              }
            >
              <p className={styles.summaryNumber}>{item.value}</p>
              <p className="mt-2 text-base lg:text-[17px] font-semibold leading-6 text-[#666666]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className={styles.content}>
          <SectionHeader
            eyebrow="성과 분야"
            title="필요한 결과에 맞춰 확인하세요"
            description="지원사업 선정과 입찰·입점은 준비 방식이 다릅니다. 각 분야에서 기업 과제, 울림 수행, 최종 성과를 같은 순서로 공개합니다."
          />

          <div className={styles.tracks}>
            {successTracks(metrics).map((track) => {
              const Icon = track.icon;
              return (
                <article key={track.href} className={styles.track}>
                  <div className={styles.trackCopy}>
                    <div className={styles.trackLabel}>
                      <Icon size={24} aria-hidden="true" />
                      <p>{track.eyebrow}</p>
                    </div>
                    <h2>{track.title}</h2>
                    <p className={styles.trackDescription}>{track.description}</p>
                    <div className={styles.trackResult}>
                      <p>{track.result}</p>
                      <span>{track.resultLabel}</span>
                    </div>
                    <ul className={styles.trackPoints}>
                      {track.points.map((point) => (
                        <li key={point}>
                          <CheckCircle2 size={17} aria-hidden="true" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Link href={track.href} className={styles.trackLink}>
                    상세 성공사례 보기
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>

          <p className="mt-7 text-center text-[14px] leading-6 text-[var(--muted)]">
            모든 고객사는 업종형 익명명으로 표기하며, 고객사 보호 범위 안에서 성과 수치와 사업명만 제공합니다.
          </p>
        </div>
      </section>

      <ContactBand />
    </div>
  );
}
