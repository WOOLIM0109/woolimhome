import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { pptCases } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "주요사례 | 입찰/입점/PPT",
  description:
    "울림컴퍼니의 입찰제안서·입점 제안·발표 PT·수상 자료 주요 성과 — 공공조달 입찰 12억·10억 낙찰, 더현대·CJ온스타일·카카오 선물하기 입점 등.",
  alternates: { canonical: buildCanonical("/cases/ppt") },
};

export default function PptCasesPage() {
  const allItems = pptCases.flatMap((g) => g.items);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "주요사례", href: "/cases/consulting" },
            { name: "입찰/입점/PPT", href: "/cases/ppt" },
          ]),
          itemListSchema(
            "입찰/입점/PPT 주요사례",
            allItems.map((item) => ({ title: item.title, description: item.result, href: "/cases/ppt" })),
          ),
        ]}
      />
      <PageHero
        eyebrow="주요사례"
        title="입찰·입점·PPT 주요사례"
        description="평가 기준과 청중 이해도를 고려해 서류와 발표 자료의 설득 흐름을 설계합니다. 모든 사례는 울림컴퍼니가 전체 서류·PPT를 기획·디자인했습니다."
      />

      {pptCases.map((group, gi) => {
        const Icon = group.icon;
        return (
          <section key={group.group} className={gi % 2 ? "bg-[var(--surface-strong)]" : "bg-white"}>
            <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Icon size={22} />
                </div>
                <h2 className="section-title text-2xl text-[#14100c] lg:text-3xl">{group.group}</h2>
              </div>
              <div className="mt-8 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <article key={`${item.company}-${item.title}`} className="card h-full p-6">
                    <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold text-[var(--primary)]">
                      {item.company}
                    </span>
                    <h3 className="mt-4 flex-1 text-lg font-bold leading-7 text-[#14100c]">{item.title}</h3>
                    <p className="mt-4 text-xl font-bold text-[var(--primary)]">{item.result}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      <section className="bg-[var(--deep)] text-white">
        <div className="mx-auto max-w-4xl px-5 py-14 text-center lg:px-8 lg:py-20">
          <SectionHeader
            align="center"
            light
            eyebrow="울림의 강점"
            title="스토리의 시각화, 울림컴퍼니의 전문 영역입니다"
          />
        </div>
      </section>

      <ContactBand />
    </>
  );
}
