import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import ContactForm from "@/components/ContactForm";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { commonFaqs } from "@/data/content";
import { site } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";

export const metadata: Metadata = {
  title: "문의하기",
  description: "울림컴퍼니 상담 신청. 전화·이메일·카카오톡 또는 온라인 상담 폼으로 문의하실 수 있습니다.",
  alternates: { canonical: buildCanonical("/contact") },
};

const channels = [
  { icon: Phone, label: "전화 문의", value: site.phone, href: `tel:${site.phone.replaceAll("-", "")}` },
  { icon: MessageCircle, label: "카카오톡 채널", value: "채널로 바로 문의", href: site.kakaoUrl },
  { icon: Mail, label: "이메일", value: site.email, href: `mailto:${site.email}` },
];

export default function ContactPage() {
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "홈", href: "/" },
            { name: "상담신청", href: "/contact" },
            { name: "문의하기", href: "/contact" },
          ]),
          faqSchema(commonFaqs),
        ]}
      />
      <PageHero
        eyebrow="상담신청"
        title="상담 신청하기"
        description="계약하지 않으셔도 됩니다. 먼저 상황을 들어보고 기업에 맞는 방향을 제안드립니다. 가능한 자료를 함께 남겨주시면 더 구체적으로 안내드릴 수 있습니다."
      />

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[1fr_0.85fr] lg:px-8 lg:py-24">
          {/* 폼 */}
          <div>
            <SectionHeader eyebrow="온라인 상담" title="온라인 상담 신청" />
            <div className="mt-7">
              <ContactForm />
            </div>
          </div>

          {/* 연락처 */}
          <div>
            <SectionHeader eyebrow="바로 연결" title="바로 연결하기" />
            <div className="mt-7 grid gap-3">
              {channels.map(({ icon: Icon, label, value, href }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={href.startsWith("http") ? "noreferrer" : undefined}
                  className="card card-hover flex-row items-center gap-4 p-5"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                    <Icon size={22} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
                    <p className="mt-1 font-bold text-[#14100c]">{value}</p>
                  </div>
                </a>
              ))}

              <div className="card gap-3 p-6">
                <div className="flex items-start gap-3">
                  <MapPin size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                  <p className="text-sm leading-6 text-[#2d241d]">{site.address}</p>
                </div>
                <div className="flex items-start gap-3">
                  <Clock size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                  <p className="text-sm leading-6 text-[#2d241d]">
                    {site.businessHours} · {site.closedDays} 휴무
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
