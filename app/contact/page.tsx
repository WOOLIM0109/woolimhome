import type { Metadata } from "next";
import { ArrowUpRight, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import ContactForm from "@/components/ContactForm";
import JsonLd from "@/components/JsonLd";
import PageHero from "@/components/PageHero";
import SectionHeader from "@/components/SectionHeader";
import { commonFaqs } from "@/data/content";
import { site } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import styles from "./contact.module.css";

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

      <section className={styles.section}>
        <div className={styles.layout}>
          {/* 폼 */}
          <div>
            <SectionHeader eyebrow="ONLINE INQUIRY" title="온라인 상담 신청" />
            <div className={styles.formWrap}>
              <ContactForm />
            </div>
          </div>

          {/* 연락처 */}
          <aside className={styles.aside}>
            <SectionHeader eyebrow="CONTACT" title="바로 연결하기" />
            <div className={styles.channels}>
              {channels.map(({ icon: Icon, label, value, href }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={href.startsWith("http") ? "noreferrer" : undefined}
                  className={styles.channel}
                >
                  <Icon size={21} className={styles.channelIcon} aria-hidden="true" />
                  <div>
                    <p className={styles.channelLabel}>{label}</p>
                    <p className={styles.channelValue}>{value}</p>
                  </div>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </a>
              ))}

              <div className={styles.office}>
                <div>
                  <MapPin size={18} aria-hidden="true" />
                  <p>{site.address}</p>
                </div>
                <div>
                  <Clock size={18} aria-hidden="true" />
                  <p>
                    {site.businessHours} · {site.closedDays} 휴무
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
