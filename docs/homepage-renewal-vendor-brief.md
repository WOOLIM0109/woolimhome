# Woolim Company Homepage Renewal Vendor Brief

This brief is for the external design/development vendor working on the Woolim Company public homepage renewal.

The goal is to improve the public website information architecture and visual design while preserving existing content, GEO/SEO structure, and operational code.

## Project Goal

Renew the Woolim Company public homepage so that visitors can quickly understand:

- What Woolim Company does
- Why the company is credible
- What services are available
- What results and portfolio examples exist
- How to request consultation

The site should feel professional, trustworthy, substantial, and polished. It should avoid looking like a temporary landing page.

## Work Scope

Included:

- Public homepage visual design
- Public navigation structure
- Public page layout and component design
- Public content reorganization
- Responsive PC/mobile layout
- Portfolio and success case page design
- Consultation CTA design

Excluded:

- Admin dashboard design
- Content automation screens
- Supabase/database changes
- Cron/worker/API automation logic
- Gemini/Naver Works integrations
- Partner portal design
- Contact form backend behavior, unless separately requested

## Approved Navigation

Use this top-level navigation:

```text
회사소개
사업영역
포트폴리오
성공사례
인사이트
[상담문의]
```

`상담문의` should be a visually distinct CTA button, not a normal text menu item.

## Menu Structure

### 회사소개

Submenus:

```text
None
```

Clicking `회사소개` should go directly to the company introduction page.

This page should include:

- Company overview
- Brand philosophy
- Representative expertise as company credibility
- Awards and press credibility
- Key trust signals
- Location/directions section

### 사업영역

Submenus:

```text
경영컨설팅
비즈니스문서/PPT
디자인서비스
```

All three service pages should use a similar content depth and structure.

Recommended structure:

```text
1. Who this service is for
2. Problems it solves
3. Scope of work
4. Process
5. Deliverables
6. Representative examples
7. FAQ
8. Consultation CTA
```

### 포트폴리오

Submenus:

```text
PPT
디자인
사업계획서/IR
```

This section should show actual deliverables and visual outcomes.

It should not duplicate long service explanations from `사업영역`.

### 성공사례

Submenus:

```text
정부지원사업/정책자금
입찰/입점
```

This section should show measurable outcomes and business results.

Use numbers, selection results, bid amounts, funding amounts, entry confirmations, and business context where available.

### 인사이트

Submenus:

```text
소식
칼럼
```

`소식` includes company news, awards, press, appointments, activity posts, and notices.

`칼럼` includes expert/practical articles and should retain GEO/SEO value.

## URL Direction

Long-term URL direction:

```text
/portfolio/*
/success/*
```

Final intended routes:

```text
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
/columns
/contact
```

Important:

- `/news` and `/columns` should remain as actual routes for stability.
- They can be shown under the visible `인사이트` menu.
- `/contact` should remain available even if it is only exposed as a CTA button.
- `/contact/pricing` should remain private/noindex and should not appear in navigation.

## Existing URL Redirects

Old public URLs should not be deleted without redirect.

Required redirects:

```text
/about/ceo              -> /about
/about/location         -> /about#location
/projects/business-docs -> /portfolio/ppt or /portfolio
/projects/design        -> /portfolio/design
/cases/consulting       -> /success/funding
/cases/ppt              -> /success/bidding-entry
```

Please coordinate before changing URL structure.

## Content Preservation

Do not delete existing public content during the first renewal pass.

Existing content should be:

- moved
- merged
- kept
- or held for owner review

Content to preserve includes:

- service explanations
- representative credentials
- company awards
- press/news items
- government support outcomes
- bidding/entry outcomes
- portfolio project images and descriptions
- FAQs
- contact details
- address and visit guidance
- client logos and trust signals

## GEO/SEO Requirements

Please preserve or coordinate before changing:

- page `metadata`
- canonical URLs
- `JsonLd` structured data
- sitemap
- robots.txt
- llms.txt
- published news slugs
- published column slugs

Do not remove structured data just because the page design changes.

Every final public page should have:

- title
- description
- canonical URL
- breadcrumb structure
- relevant structured data
- clear internal links
- consultation CTA

## Protected Areas

Please do not redesign, delete, or restructure these areas unless explicitly approved:

```text
/admin/*
/api/*
/auth/*
/partner
Supabase migrations
content automation logic
cron routes
worker routes
Gemini integration
Naver Works integration
```

These areas are operational tools and are not part of the public website redesign.

## Brand And Design Direction

Desired feel:

- professional
- polished
- substantial
- warm but not overly cute
- trustworthy
- business-focused
- modern Korean corporate/service website

Design preferences:

- Use Pretendard for body text.
- Use Paperlogy for display/headline text where appropriate.
- Avoid harsh, overly bright orange.
- Use Woolim's orange as a refined gradient/accent.
- Buttons may use subtle floating/shadow effects.
- The main page should feel heavier and more premium than a simple landing page.
- Logo does not need to dominate the hero area.
- Real work visuals, document/portfolio visuals, office/business context imagery, or strong editorial layout are preferred.

Avoid:

- temporary landing page feel
- thin one-screen sales page
- excessive generic stock visuals
- hardcoded content that duplicates existing data sources
- removing GEO/SEO code during visual changes

## Preferred Deliverables

Preferred vendor deliverables:

- Figma design file, or
- responsive HTML/CSS prototype, or
- Next.js components/pages through a separate branch/PR

If working directly in Git:

- Work on a separate branch.
- Do not commit directly to `main`.
- Open a PR for review.
- Keep public design changes separated from admin/automation changes.

## Review Checklist

Before delivery, confirm:

- PC and mobile layouts are responsive.
- Navigation matches approved structure.
- Existing content is not lost.
- Portfolio and success cases are clearly separated.
- `/contact` remains easy to reach.
- `/contact/pricing` remains hidden/private.
- Metadata and structured data are preserved.
- Old public URLs have redirects.
- New pages are included in sitemap.
- Admin/API/partner pages are not exposed in public navigation.
