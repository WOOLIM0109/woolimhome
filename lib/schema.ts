import { commonFaqs, services } from "@/data/content";
import { navigation, site } from "@/data/site";
import { SITE_URL, toAbsoluteUrl } from "@/lib/site-config";

type JsonLd = Record<string, unknown>;

export function organizationSchema(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "ProfessionalService", "LocalBusiness"],
    "@id": `${SITE_URL}/#organization`,
    name: site.name,
    alternateName: site.englishName,
    url: SITE_URL,
    description: site.description,
    telephone: site.phone,
    email: site.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address,
      addressLocality: "부산광역시",
      addressCountry: "KR",
    },
    founder: {
      "@type": "Person",
      name: site.representative,
      jobTitle: "대표 / 국가공인 경영지도사",
      knowsAbout: ["경영컨설팅", "정부지원사업", "사업계획서", "기업인증", "IR 자료", "PPT 디자인"],
    },
    areaServed: {
      "@type": "Country",
      name: "대한민국",
    },
    knowsAbout: site.keywords,
    award: site.award,
    sameAs: [site.awardArticleUrl],
  };
}

export function websiteSchema(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: site.name,
    alternateName: site.englishName,
    url: SITE_URL,
    inLanguage: "ko-KR",
    publisher: { "@id": `${SITE_URL}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function serviceSchemas(): JsonLd[] {
  return services.map((service) => ({
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${toAbsoluteUrl(service.href)}#service`,
    name: service.title,
    description: service.summary,
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: "대한민국",
    serviceType: service.title,
    url: toAbsoluteUrl(service.href),
  }));
}

export function breadcrumbSchema(items: Array<{ name: string; href: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.href),
    })),
  };
}

export function faqSchema(faqs: Array<{ question: string; answer: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function itemListSchema(name: string, items: Array<{ title: string; href?: string; description?: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "CreativeWork",
        name: item.title,
        description: item.description,
        url: item.href ? toAbsoluteUrl(item.href) : SITE_URL,
        provider: { "@id": `${SITE_URL}/#organization` },
      },
    })),
  };
}

export function newsArticleSchema(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "울림컴퍼니 2026 올해의 고객만족브랜드대상 경영컨설팅 부문 1위 수상",
    datePublished: "2026-06-23",
    author: {
      "@type": "Organization",
      name: "공감신문",
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: { "@id": `${SITE_URL}/#organization` },
    citation: site.awardArticleUrl,
  };
}

export function navFlatLinks() {
  return navigation.flatMap((item) => [item, ...(item.children || [])]);
}

export function allFaqs() {
  return [...commonFaqs, ...services.flatMap((service) => service.faq)];
}

