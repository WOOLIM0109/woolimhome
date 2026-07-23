import type { Metadata } from "next";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import { columns } from "@/data/content";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "칼럼",
  description: "정부지원사업, 사업계획서, IR 자료, 입찰제안서 준비에 도움이 되는 울림컴퍼니 칼럼입니다.",
  alternates: { canonical: buildCanonical("/columns") },
};

export default function ColumnsPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }, { name: "알림마당", href: "/news" }, { name: "칼럼", href: "/columns" }]),
          itemListSchema("울림컴퍼니 칼럼", columns.map((item) => ({ title: item.title, description: item.summary, href: "/columns" }))),
        ]}
      />
      <PageHero eyebrow="칼럼" title="칼럼" description="사업계획서, IR, 입찰제안서, 정부지원사업 준비에 필요한 실무 관점을 정리합니다." />
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl items-stretch gap-4 px-5 py-16 lg:grid-cols-3 lg:px-8 lg:py-20">
          {columns.map((item) => (
            <article key={item.title} className="card card-hover h-full p-7">
              <p className="eyebrow">Column</p>
              <h2 className="mt-4 text-xl font-bold leading-7 text-[#14100c]">{item.title}</h2>
              <p className="prose-muted mt-4 flex-1 text-sm">{item.summary}</p>
            </article>
          ))}
        </div>
      </section>
      <ContactBand />
    </>
  );
}

