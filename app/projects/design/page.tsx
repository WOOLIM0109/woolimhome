import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ImageIcon, Palette } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { designFields, projectDesignReady } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "프로젝트 | 시각디자인",
  description: "울림컴퍼니의 로고, 명함, 카다로그, 브로셔, 리플렛, 포스터 등 시각디자인 프로젝트를 소개합니다.",
  alternates: { canonical: buildCanonical("/projects/design") },
};

export default function DesignProjectsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "프로젝트", href: "/projects/business-docs" },
            { name: "시각디자인", href: "/projects/design" },
          ]),
          itemListSchema(
            "시각디자인 프로젝트",
            designFields.map((f) => ({ title: f.name, description: f.desc, href: "/projects/design" })),
          ),
        ]}
      />
      <PageHero
        eyebrow="시각디자인"
        title="시각디자인 프로젝트"
        description="브랜드의 첫인상을 만드는 홍보·편집 디자인물을 분야별로 정리합니다."
      />

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader eyebrow="제작 분야" title="이런 디자인을 만듭니다" />
          <div className="mt-9 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designFields.map((f) => (
              <article key={f.name} className="card h-full p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                  <Palette size={20} />
                </div>
                <h2 className="mt-4 text-lg font-bold text-[#14100c]">{f.name}</h2>
                <p className="prose-muted mt-2 flex-1 text-sm">{f.desc}</p>
              </article>
            ))}
          </div>

          {!projectDesignReady && (
            <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#e6c6ad] bg-[var(--surface-strong)] p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow">
                <ImageIcon size={26} />
              </div>
              <h3 className="text-lg font-bold text-[#14100c]">포트폴리오 이미지 준비 중입니다</h3>
              <p className="prose-muted max-w-xl text-sm">
                시각디자인 결과물 갤러리는 현재 정리 중입니다. 제작 가능한 분야와 사례는 상담을 통해 바로 안내해
                드립니다.
              </p>
              <Link
                href="/contact"
                className="btn-gradient inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-white"
              >
                디자인 상담하기 <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </section>

      <ContactBand />
    </>
  );
}
