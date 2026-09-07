# Homepage Renewal Menu Structure

This document defines the approved public navigation structure for the Woolim Company homepage renewal.

## Approved Top Navigation

The public header navigation should use this structure:

```text
회사소개
사업영역
포트폴리오
성공사례
인사이트
[상담문의]
```

`상담문의` is a call-to-action button, not a normal text menu item.

## Menu Details

### 회사소개

Visible label:

```text
회사소개
```

Submenus:

```text
None
```

Behavior:

- Clicking `회사소개` goes directly to the company introduction page.
- The previous CEO/profile and location pages are merged into the company page.
- The representative's qualifications should be framed as company trust signals, not as a separate personal-profile area.

Content to preserve:

- Company philosophy
- Representative expertise
- National certified management consultant credential
- Supplier/company appointments
- Award and press credibility
- Address and visit guidance

### 사업영역

Visible label:

```text
사업영역
```

Submenus:

```text
경영컨설팅
비즈니스문서/PPT
디자인서비스
```

Behavior:

- Keep the current three-service structure.
- Rebalance content volume across the three detail pages.
- Use a consistent content framework across all service pages, then allow design variation by page.

Recommended common page framework:

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

Visible label:

```text
포트폴리오
```

Submenus:

```text
PPT
디자인
사업계획서/IR
```

Behavior:

- This area shows visual/project deliverables.
- It should focus on what Woolim actually produced.
- It should not duplicate the service explanations from `사업영역`.

Content role:

- PPT: presentation, proposal, company deck, report deck, lecture deck examples
- 디자인: brand, catalog, brochure, leaflet, poster, editorial/print design examples
- 사업계획서/IR: business plan, IR, government-support plan examples

### 성공사례

Visible label:

```text
성공사례
```

Submenus:

```text
정부지원사업/정책자금
입찰/입점
```

Behavior:

- This area shows outcomes, not just deliverables.
- It should be separated from `포트폴리오`.
- Use numbers, selection results, funding amounts, bid amounts, entry confirmations, and business context.

Content role:

- 정부지원사업/정책자금: TIPS, R&D, early-stage startup support, youth startup academy, policy funding, certification-linked growth cases
- 입찰/입점: public procurement, proposal wins, department store/platform entry, partnership proposal cases

### 인사이트

Visible label:

```text
인사이트
```

Submenus:

```text
소식
칼럼
```

Behavior:

- `소식` includes notices, press, award news, appointment news, and company activity updates.
- `칼럼` keeps practical expert articles for GEO/SEO.
- Press coverage does not need a separate top-level submenu unless content volume grows later.

### 상담문의

Visible label:

```text
상담문의
```

Type:

```text
Header CTA button
```

Behavior:

- Keep `/contact` as a public page.
- Remove `상담신청` as a normal navigation category.
- Keep contact links in header CTA, footer, service page CTA, portfolio page CTA, and success case CTA.

## Current-To-New Navigation Mapping

```text
회사소개
- 울림컴퍼니 소개   -> 회사소개
- 대표 소개         -> 회사소개 page section
- 오시는 길         -> 회사소개/contact page section

사업영역
- 경영컨설팅        -> 사업영역 > 경영컨설팅
- 비즈니스문서/PPT  -> 사업영역 > 비즈니스문서/PPT
- 디자인서비스      -> 사업영역 > 디자인서비스

프로젝트
- 비즈니스문서/PPT  -> 포트폴리오 > PPT and 포트폴리오 > 사업계획서/IR
- 시각디자인        -> 포트폴리오 > 디자인

주요사례
- 컨설팅/사업계획서 -> 성공사례 > 정부지원사업/정책자금
- 입찰/입점/PPT     -> 성공사례 > 입찰/입점

알림마당
- 소식/언론보도     -> 인사이트 > 소식
- 칼럼              -> 인사이트 > 칼럼

상담신청
- 문의하기          -> 상담문의 CTA button and /contact page
```

## GEO/URL Principle

Visible menu labels may change, but valuable public URLs should not simply disappear.

Use redirects for removed or merged pages.

Long-term URL direction:

```text
/portfolio/* for portfolio pages
/success/* for success case pages
```

Use redirects from the current public URLs to the new long-term URLs after the content migration has been reviewed.

Approved long-term route strategy:

```text
/about                  -> 회사소개
/services/consulting    -> 사업영역 > 경영컨설팅
/services/business-docs -> 사업영역 > 비즈니스문서/PPT
/services/design        -> 사업영역 > 디자인서비스
/portfolio/ppt          -> 포트폴리오 > PPT
/portfolio/design       -> 포트폴리오 > 디자인
/portfolio/business-ir  -> 포트폴리오 > 사업계획서/IR
/success/funding        -> 성공사례 > 정부지원사업/정책자금
/success/bidding-entry  -> 성공사례 > 입찰/입점
/news                   -> 인사이트 > 소식
/columns                -> 인사이트 > 칼럼
/contact                -> 상담문의 CTA
```

Recommended redirects:

```text
/about/ceo               -> /about
/about/location          -> /about#location
/projects/business-docs  -> /portfolio/ppt
/projects/design         -> /portfolio/design
/cases/consulting        -> /success/funding
/cases/ppt               -> /success/bidding-entry
```

Keep or remap:

- `/about`
- `/about/ceo`
- `/about/location`
- `/services/consulting`
- `/services/business-docs`
- `/services/design`
- `/projects/business-docs`
- `/projects/design`
- `/cases/consulting`
- `/cases/ppt`
- `/news`
- `/news/[slug]`
- `/columns`
- `/columns/[slug]`
- `/contact`

## Confirmed Decisions

Resolved:

- `인사이트` is the final visible label.
- Portfolio pages should use `/portfolio/*` long term.
- Success case pages should use `/success/*` long term.
- `/about/location` should redirect to `/about#location`.

Implementation details to confirm while coding:

1. Whether `/projects/business-docs` should redirect to `/portfolio/ppt`, or whether it should redirect to a portfolio landing page if one is created.
2. Whether `/portfolio/business-ir` is the final English slug for `사업계획서/IR`.
3. Whether `/success/funding` is the final English slug for `정부지원사업/정책자금`.

## Implementation Guardrails

- Do not delete content while changing navigation.
- Do not remove page metadata without replacing it.
- Do not remove `JsonLd` structured data without a replacement.
- Do not remove published news or column slugs.
- Do not expose admin, partner, API, cron, worker, or automation pages in public navigation.
- Do not make `/contact` unreachable just because it is no longer a normal menu item.
