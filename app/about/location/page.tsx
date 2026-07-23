import type { Metadata } from "next";
import { Car, Clock, Mail, MapPin, MessageCircle, Phone, Printer, TrainFront } from "lucide-react";
import ContactBand from "@/components/ContactBand";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { site } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "오시는 길",
  description: `${site.address}에 위치한 울림컴퍼니 오시는 길과 대중교통·주차 안내입니다.`,
  alternates: { canonical: buildCanonical("/about/location") },
};

const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(site.address)}&hl=ko&z=17&output=embed`;

const info = [
  { icon: MapPin, label: "주소", value: site.address },
  { icon: Phone, label: "대표번호", value: site.phone, href: `tel:${site.phone.replaceAll("-", "")}` },
  { icon: Printer, label: "팩스", value: site.fax },
  { icon: Mail, label: "이메일", value: site.email, href: `mailto:${site.email}` },
  { icon: Clock, label: "운영시간", value: `${site.businessHours} (${site.closedDays} 휴무)` },
  { icon: MessageCircle, label: "카카오톡 채널", value: "채널로 바로 문의하기", href: site.kakaoUrl },
];

export default function LocationPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "홈", href: "/" },
          { name: "회사소개", href: "/about" },
          { name: "오시는 길", href: "/about/location" },
        ])}
      />
      <PageHero
        eyebrow="오시는 길"
        title="오시는 길"
        description="방문 상담은 전화 또는 카카오톡 채널로 일정을 먼저 문의해 주세요."
      />

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[1.3fr_1fr] lg:px-8 lg:py-24">
          {/* 지도 */}
          <div className="overflow-hidden rounded-3xl border border-[var(--line)] shadow-[var(--shadow-card)]">
            <iframe
              title="울림컴퍼니 위치"
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-[360px] w-full lg:h-full lg:min-h-[460px]"
            />
          </div>

          {/* 정보 */}
          <div className="grid content-start gap-3">
            {info.map(({ icon: Icon, label, value, href }) => (
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
      </section>

      {/* 교통/주차 */}
      <section className="bg-[var(--surface-strong)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
          <SectionHeader eyebrow="교통 안내" title="찾아오시는 방법" />
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
