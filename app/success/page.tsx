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

const summary = [
  { value: "20억+", label: "사업 진입 2년 내 지원사업 누적 유치" },
  { value: "12억", label: "단일 공공조달 최대 낙찰" },
  { value: "1,000+", label: "보유한 실제 컨설팅 사례" },
];

const successTracks = [
  {
    href: "/success/funding",
    icon: Landmark,
    eyebrow: "정부지원사업·정책자금",
    title: "기업의 성장 단계에 맞는 과제를 연결합니다",
    description:
      "사업화, R&D, 정책자금의 목적을 구분하고 기업 상황에 맞는 로드맵과 평가 문서를 설계합니다.",
    result: "8억 원",
    resultLabel: "TIPS R&D 단일 과제 최대 선정",
    points: [
      "AI 플랫폼 스타트업 지원사업 5건 연속 선정",
      "수면테크 앱 기업 사업화·R&D 2억 7천만 원",
      "문화예술 지원사업 6억 원 선정",
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
    result: "12억 원",
    resultLabel: "서울 공공서비스 용역 낙찰",
    points: [
      "공공조달 입찰 낙찰 사례 5건",
      "더현대·CJ온스타일·카카오 입점·제휴",
      "발표 코칭 포함 대회·수상 사례 2건",
    ],
    accent: "green",
  },
];

const representativeResults = [
  {
    title: "AI 플랫폼 스타트업 TIPS R&D 선정",
    description: "사업화부터 후속 R&D까지 연결해 TIPS 8억 원을 포함한 지원사업 5건 선정",
    href: "/success/funding#case-ai-platform-tips",
  },
  {
    title: "수면테크 앱 기업 R&D 확장",
    description: "초기창업패키지와 창업성장기술개발 디딤돌을 연결해 총 2억 7천만 원 선정",
    href: "/success/funding#case-sleep-tech-rnd",
  },
  {
    title: "서울 공공서비스 용역 낙찰",
    description: "평가항목 분석부터 입찰서류와 발표자료까지 기획·디자인해 12억 원 낙찰",
    href: "/success/bidding-entry#case-seoul-public-service",
  },
  {
    title: "백화점·플랫폼 입점 및 제휴",
    description: "더현대 팝업스토어, CJ온스타일, 카카오톡 선물하기 제안 성과",
    href: "/success/bidding-entry",
  },
];

export default function SuccessPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "성공사례", href: "/success" }]),
          itemListSchema("울림컴퍼니 대표 성공사례", representativeResults),
        ]}
      />

      <PageHero
        eyebrow="성공사례"
        title="결과만이 아니라, 결과를 만든 과정을 보여드립니다"
        description="기업의 상황을 진단하고 전략, 문서, 발표를 연결해 선정·유치·낙찰·입점으로 이어진 실제 사례입니다."
      />

      <section className="border-b border-[var(--line)] bg-[#f5efe9]" aria-label="울림컴퍼니 대표 성과">
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
              <p className="text-4xl font-black text-[var(--primary)] lg:text-5xl">{item.value}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#5c4d43]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <SectionHeader
            eyebrow="성과 분야"
            title="필요한 결과에 맞춰 확인하세요"
            description="지원사업 선정과 입찰·입점은 준비 방식이 다릅니다. 각 분야에서 기업 과제, 울림 수행, 최종 성과를 같은 순서로 공개합니다."
          />

          <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-2">
            {successTracks.map((track) => {
              const Icon = track.icon;
              const green = track.accent === "green";
              return (
                <article
                  key={track.href}
                  className={
                    green
                      ? "flex h-full flex-col overflow-hidden rounded-lg border border-[#cdded8] bg-[#f4f8f6] shadow-[var(--shadow-card)]"
                      : "flex h-full flex-col overflow-hidden rounded-lg border border-[#ecd8ca] bg-[#fff8f2] shadow-[var(--shadow-card)]"
                  }
                >
                  <div className="flex flex-1 flex-col p-6 sm:p-8">
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          green
                            ? "flex h-11 w-11 items-center justify-center rounded-lg bg-[#1f6454] text-white"
                            : "flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--primary)] text-white"
                        }
                      >
                        <Icon size={22} aria-hidden="true" />
                      </span>
                      <p className={green ? "text-sm font-bold text-[#1f6454]" : "text-sm font-bold text-[var(--primary)]"}>
                        {track.eyebrow}
                      </p>
                    </div>

                    <h2 className="mt-6 text-3xl font-black leading-[1.3] text-[#211811]">{track.title}</h2>
                    <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{track.description}</p>

                    <div className="mt-8 border-y border-current/10 py-6">
                      <p className={green ? "text-4xl font-black text-[#1f6454]" : "text-4xl font-black text-[var(--primary)]"}>
                        {track.result}
                      </p>
                      <p className="mt-2 text-sm font-bold text-[#3d3027]">{track.resultLabel}</p>
                    </div>

                    <ul className="mt-6 flex-1 space-y-3">
                      {track.points.map((point) => (
                        <li key={point} className="flex gap-3 text-sm leading-7 text-[#4a3c33]">
                          <CheckCircle2
                            size={17}
                            className={green ? "mt-1 shrink-0 text-[#1f6454]" : "mt-1 shrink-0 text-[var(--primary)]"}
                            aria-hidden="true"
                          />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    href={track.href}
                    className={
                      green
                        ? "flex min-h-14 items-center justify-between border-t border-[#cdded8] px-6 text-sm font-black text-[#1f6454] transition hover:bg-white sm:px-8"
                        : "flex min-h-14 items-center justify-between border-t border-[#ecd8ca] px-6 text-sm font-black text-[var(--primary)] transition hover:bg-white sm:px-8"
                    }
                  >
                    상세 성공사례 보기
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>

          <p className="mt-7 text-center text-xs leading-6 text-[var(--muted)]">
            모든 고객사는 업종형 익명명으로 표기하며, 고객사 보호 범위 안에서 성과 수치와 사업명만 제공합니다.
          </p>
        </div>
      </section>

      <ContactBand />
    </>
  );
}
