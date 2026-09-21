import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import SiteMain from "@/components/SiteMain";
import { site } from "@/data/site";
import { DEFAULT_OG_IMAGE, SITE_URL, buildCanonical } from "@/lib/site-config";
import { organizationSchema, serviceSchemas, websiteSchema } from "@/lib/schema";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${site.name} | 경영컨설팅·사업계획서·PPT·디자인`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: site.keywords,
  alternates: {
    canonical: buildCanonical("/"),
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: site.name,
    url: SITE_URL,
    title: `${site.name} | 비즈니스 성장 파트너`,
    description: site.description,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1500, height: 1500, alt: "울림컴퍼니 로고" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} | 비즈니스 성장 파트너`,
    description: site.description,
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" className={pretendard.variable}>
      <body>
        <JsonLd data={[websiteSchema(), organizationSchema(), ...serviceSchemas()]} />
        <Header />
        <SiteMain>{children}</SiteMain>
        <Footer />
      </body>
    </html>
  );
}
