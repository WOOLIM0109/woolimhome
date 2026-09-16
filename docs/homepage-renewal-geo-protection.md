# Homepage Renewal GEO Protection

This document defines the GEO/SEO protection rules for the Woolim Company homepage renewal.

The goal is to change the visible information architecture without losing search, AI reference, structured data, or existing public URL value.

## Protected Files

Do not remove or rewrite these files casually during the renewal:

| File | Role | Rule |
| --- | --- | --- |
| `app/layout.tsx` | Global metadata, Open Graph, Twitter card, root `JsonLd` | Preserve global metadata and schemas. |
| `lib/site-config.ts` | Site URL, canonical helpers, OG image helper | Keep canonical URL generation centralized. |
| `lib/schema.ts` | Organization, Website, Service, Breadcrumb, FAQ, Article schemas | Update intentionally when routes change. Do not delete schemas. |
| `components/JsonLd.tsx` | Structured data renderer | Keep available to all public pages. |
| `app/sitemap.ts` | Sitemap generation | Update for new `/portfolio/*` and `/success/*` URLs. |
| `app/robots.ts` | Robots rules and sitemap location | Keep public pages crawlable; keep admin/API private. |
| `app/llms.txt/route.ts` | AI-readable company/service reference | Update important URLs and menu names after renewal. |
| `data/site.ts` | Company facts, domain, navigation, contact, award, keywords | Keep as source of truth. |
| `data/content.ts` | Services, FAQs, cases, portfolio, trust content | Preserve content during migration. |
| `data/news.ts` | News items and slugs | Preserve slugs and article facts. |
| `app/news/[slug]/page.tsx` | News detail metadata and NewsArticle schema | Preserve published slugs and Article schema. |
| `app/columns/[slug]/page.tsx` | Column detail metadata, Article/FAQ schema | Preserve published slugs and dynamic metadata. |
| `app/contact/pricing/page.tsx` | Private pricing page | Keep noindex and out of navigation. |

## Final Public URL Strategy

Use the approved visible menu:

```text
회사소개
사업영역
포트폴리오
성공사례
인사이트
[상담문의]
```

Final intended public route groups:

```text
/about
/services/*
/portfolio/*
/success/*
/news
/news/[slug]
/columns
/columns/[slug]
/contact
```

Keep `/news` and `/columns` as actual routes for stability, while exposing them under `인사이트`.

## Redirect Requirements

Old public URLs must redirect only after the replacement page exists.

Required redirects:

```text
/about/ceo              -> /about
/about/location         -> /about#location
/projects/business-docs -> /portfolio/ppt or /portfolio
/projects/design        -> /portfolio/design
/cases/consulting       -> /success/funding
/cases/ppt              -> /success/bidding-entry
```

Redirect implementation options:

- Prefer `next.config.ts` redirects for static public route remaps.
- Use page-level redirects only if the route needs logic.
- Use permanent redirects after final URLs are confirmed.
- Use temporary redirects during preview or internal review.

## Metadata Rules

Every final public page must have:

- `title`
- `description`
- canonical URL via `buildCanonical(...)`
- Open Graph data if it is a major landing/detail page
- Breadcrumb schema when the page is part of menu hierarchy
- relevant ItemList, FAQ, Service, Article, or NewsArticle schema

Important canonical rules:

```text
/portfolio/ppt          canonical -> /portfolio/ppt
/portfolio/design       canonical -> /portfolio/design
/portfolio/business-ir  canonical -> /portfolio/business-ir
/success/funding        canonical -> /success/funding
/success/bidding-entry  canonical -> /success/bidding-entry
/news                   canonical -> /news
/columns                canonical -> /columns
```

Redirected old pages must not keep self-canonical metadata if they no longer render as normal pages.

## Structured Data Rules

Preserve:

- Organization schema
- Service schema for the three service pages
- Breadcrumb schema for all menu/detail pages
- FAQ schema where FAQs remain visible
- ItemList schema for portfolio, success case, news, and column list pages
- Article or NewsArticle schema for detail pages

Update:

- Breadcrumb labels from old menu labels to new labels.
- ItemList URLs from old `/projects/*` and `/cases/*` paths to new `/portfolio/*` and `/success/*` paths.
- `llms.txt` important URLs.

Remove or fix:

- `WebSite` `SearchAction` currently points to `/search`, but no `/search` route exists. Either create `/search` or remove `potentialAction`.

## Sitemap Rules

The sitemap must include final public pages:

```text
/
/about
/services/consulting
/services/business-docs
/services/design
/portfolio/ppt
/portfolio/design
/portfolio/business-ir
/success/funding
/success/bidding-entry
/news
/news/[published-slug]
/columns
/columns/[published-slug]
/contact
```

The sitemap should not include:

```text
/admin/*
/api/*
/auth/*
/partner
/contact/pricing while private
```

Implementation note:

- `app/sitemap.ts` currently derives many URLs from `navigation`.
- When `navigation` changes, ensure new final routes appear and removed routes do not remain accidentally.
- Published news and columns should continue to be added dynamically.

## Robots Rules

Keep:

```text
Allow: /
Allow: /llms.txt
Disallow: /admin/
Disallow: /api/admin/
Sitemap: /sitemap.xml
```

Do not block:

```text
/portfolio/*
/success/*
/news
/columns
/contact
```

Keep private:

```text
/admin/*
/api/admin/*
/partner
/contact/pricing
```

Note: `/partner` has page-level `robots: { index: false, follow: false }`; keep it out of public navigation.

## llms.txt Rules

Update `app/llms.txt/route.ts` after route changes.

It should mention:

- Core services
- Representative/company trust signals
- Award and press citation
- Government support/funding success cases
- Bidding/entry success cases
- Portfolio URLs
- Contact URL
- Official domain

It should not mention:

- Admin URLs
- Partner URLs
- Private pricing URL
- Draft or unpublished content

## Known Cleanup Items

These cleanup items should be handled during implementation:

1. Remove or implement the `/search` target used by `SearchAction` in `lib/schema.ts`.
2. Remove nested `<main>` from `app/news/[slug]/page.tsx`; the root layout already provides `<main>`.
3. Consider replacing nested `<main>` in `components/admin/AdminPortal.tsx` with a non-main element, even though admin is not GEO-critical.
4. Update `.env.example` and production environment values from temporary Vercel URLs to the official domain.
5. Update Naver Works redirect URI examples when the official domain is used.
6. Keep `/contact/pricing` noindex and out of sitemap/navigation while private.

## Deployment Environment Requirements

Production must set:

```text
NEXT_PUBLIC_SITE_URL=https://official-domain
```

This value controls:

- canonical URLs
- sitemap URLs
- robots sitemap URL
- Open Graph URLs
- structured data URLs
- `llms.txt` URLs

Before public launch, verify production responses:

```text
/robots.txt
/sitemap.xml
/llms.txt
/
/about
/portfolio/ppt
/success/funding
/news
/columns
/contact
```

## Vendor Handoff Rules

Design vendors may change visual layout and component markup, but should not delete:

- page metadata exports
- `JsonLd` components
- schema helpers
- sitemap/robots/llms routes
- existing published news and column slugs
- content source data unless migration is explicitly approved

If a design vendor creates new pages, they must include placeholders for:

- metadata
- canonical
- breadcrumb schema
- page-specific structured data
- footer/contact CTA

## Acceptance Criteria

GEO protection is satisfied when:

- Every final public page has metadata and canonical.
- Every removed old public URL redirects to the right new URL.
- Sitemap lists final public pages.
- Robots does not block final public pages.
- `llms.txt` reflects the new structure.
- `SearchAction` no longer points to a missing route.
- Published news/column detail pages still resolve.
- `/contact/pricing` remains private/noindex.
