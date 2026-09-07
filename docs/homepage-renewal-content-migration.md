# Homepage Renewal Content Migration

This document defines how existing public Woolim Company homepage content should move into the approved renewal structure.

The first implementation pass must preserve content. Do not delete public content until its new location is verified.

## Approved Public Structure

```text
회사소개
사업영역
  - 경영컨설팅
  - 비즈니스문서/PPT
  - 디자인서비스
포트폴리오
  - PPT
  - 디자인
  - 사업계획서/IR
성공사례
  - 정부지원사업/정책자금
  - 입찰/입점
인사이트
  - 소식
  - 칼럼
상담문의 CTA
```

## Migration Rules

- Preserve existing public text, facts, cases, FAQs, images, and slugs by default.
- Merge duplicated service explanations into `사업영역`.
- Move visual deliverables into `포트폴리오`.
- Move measurable outcomes into `성공사례`.
- Keep operational/admin content out of this migration.
- Keep `/contact` available even though it is no longer a normal top navigation menu item.
- Keep `/news` and `/columns` route paths for stability, while exposing them under `인사이트`.

## Page Migration Map

| Current source | Current role | New destination | Treatment | Notes |
| --- | --- | --- | --- | --- |
| `/about` | Company philosophy and overview | `/about` | Keep and expand | Make this the single company introduction page. |
| `/about/ceo` | Representative profile and credentials | `/about` | Merge | Frame the representative's credentials as Woolim Company trust signals. |
| `/about/location` | Directions, address, parking | `/about#location` and `/contact` | Merge and redirect | Redirect old URL to `/about#location`; keep address/contact facts on `/contact`. |
| `/services/consulting` | Consulting service detail | `/services/consulting` | Keep and rebalance | Keep service URL and schema; move detailed outcome stories to success pages. |
| `/services/business-docs` | Business documents/PPT service detail | `/services/business-docs` | Keep and rebalance | Keep service URL and schema; move visual examples to portfolio pages. |
| `/services/design` | Design service detail | `/services/design` | Keep and rebalance | Keep service URL and schema; avoid duplicating portfolio/design examples too heavily. |
| `/projects/business-docs` | Document/PPT project examples | `/portfolio/ppt` and `/portfolio/business-ir` | Split and move | Redirect old route after new portfolio pages exist. |
| `/projects/design` | Visual design project examples | `/portfolio/design` | Move | Current design portfolio assets may need owner/vendor supply. |
| `/cases/consulting` | Government support and funding outcomes | `/success/funding` | Move | Preserve funding amounts, program names, and anonymized company initials. |
| `/cases/ppt` | Bidding, entry, partnership, competition outcomes | `/success/bidding-entry` | Move | Preserve bid amounts, entry confirmations, and presentation/proposal context. |
| `/news` | Company news and press | `/news`, displayed as `인사이트 > 소식` | Keep route | Route stability is preferred. Visible label changes to `소식`. |
| `/news/[slug]` | Individual news articles | `/news/[slug]` | Keep route | Preserve published slugs and article schemas. |
| `/columns` | Column list | `/columns`, displayed as `인사이트 > 칼럼` | Keep route | Existing automation and sitemap integration depend on this route. |
| `/columns/[slug]` | Individual columns | `/columns/[slug]` | Keep route | Preserve slugs, article schema, FAQ schema, and related articles. |
| `/contact` | Consultation form and contact details | `/contact` | Keep route | Remove from normal menu but keep as header CTA and page CTA target. |
| `/contact/pricing` | Pricing page, currently closed | `/contact/pricing` | Keep private | Keep noindex. Do not add to navigation or public menu. |

## Data Source Migration Map

| Data source | Content | New use |
| --- | --- | --- |
| `data/site.ts` `site` | Company facts, contact, address, award, representative, keywords | Global source of truth for header/footer, metadata, Organization schema, contact sections. |
| `data/site.ts` `navigation` | Current public menu | Replace with approved navigation after route decisions are implemented. |
| `data/site.ts` `stats` | 1,000+ cases, 20억+, 2026 award, 33기 credential | Home page and company trust area. |
| `data/content.ts` `services` | Three main services and service FAQs | `사업영역` pages and Service schema. |
| `data/content.ts` `trustSignals` | Supplier, committee, mentor, credential trust points | `/about` trust section. |
| `data/content.ts` `ceo` | Greeting, profile images, credentials | Merge into `/about`; do not expose as a separate submenu. |
| `data/content.ts` `caseHighlights` | Home success highlights | Home page and success page teasers. |
| `data/content.ts` `clients` | Client logo marquee | Home page trust/social proof. |
| `data/content.ts` `consultingCases` | Funding/government support wins | `/success/funding`. |
| `data/content.ts` `quickWins` | Additional funding quick wins | `/success/funding` and consulting teaser. |
| `data/content.ts` `pptCases` | Bid, entry, partnership, award cases | `/success/bidding-entry`. |
| `data/content.ts` `comparison` | Woolim differentiators | Home/about/service trust sections. |
| `data/content.ts` `consultingTracks` | Consulting tracks | `/services/consulting`. |
| `data/content.ts` `certifications`, `certBenefits` | Certification consulting detail | `/services/consulting`. |
| `data/content.ts` `docProcess`, `docTypes` | Business document process/types | `/services/business-docs`. |
| `data/content.ts` `designFields`, `designDifferentiators` | Design scope/differentiators | `/services/design` and `/portfolio/design` teaser only. |
| `data/content.ts` `businessDocsProjects` | Actual document/PPT/business plan portfolio items | Split into `/portfolio/ppt` and `/portfolio/business-ir`. |
| `data/content.ts` `projectDesignReady` | Design portfolio readiness flag | Keep until design assets are finalized. |
| `data/content.ts` `projects` | Home project teaser cards | Home and portfolio landing/teasers. |
| `data/content.ts` `commonFaqs` | Common consultation FAQs | Home, service pages, contact, FAQ schema. |
| `data/news.ts` `news` | Company news, awards, activity posts | `/news` and `/news/[slug]`, visible under `인사이트 > 소식`. |
| Supabase `column_posts` | Published columns | `/columns` and `/columns/[slug]`, visible under `인사이트 > 칼럼`. |

## Portfolio Split Rules

Use these rules when moving `businessDocsProjects`.

### `/portfolio/ppt`

Include projects whose primary type is:

- `발표 PT`
- `보고서`
- `회사소개서`
- `제안서`
- `입찰제안서`
- `용역제안서`
- general presentation or deck design

### `/portfolio/business-ir`

Include projects whose primary type is:

- `사업계획서`
- `IR`
- `투자제안서`
- government support plan
- business model or funding proposal

If a project fits both, assign it by primary customer intent:

- If the user wants to inspect the visual deck, link from `/portfolio/ppt`.
- If the user wants to understand business planning or investment logic, link from `/portfolio/business-ir`.

## Success Split Rules

### `/success/funding`

Include:

- Government support selection
- Policy funding outcomes
- R&D support outcomes
- Startup package outcomes
- Certification-linked funding/growth outcomes

Preserve:

- Program names
- Selection/funding amount
- Anonymized company initials
- Business category
- Source/credibility context

### `/success/bidding-entry`

Include:

- Public procurement wins
- Bid proposal outcomes
- Department store/platform entry
- Partnership proposal outcomes
- Competition/presentation award outcomes

Preserve:

- Bid amount
- Entry or partnership result
- Client category
- Proposal/PPT involvement

## Redirect Plan

Implement redirects only after replacement pages exist.

```text
/about/ceo              -> /about
/about/location         -> /about#location
/projects/business-docs -> /portfolio/ppt
/projects/design        -> /portfolio/design
/cases/consulting       -> /success/funding
/cases/ppt              -> /success/bidding-entry
```

If a portfolio landing page is created, consider redirecting `/projects/business-docs` to `/portfolio` instead of `/portfolio/ppt`.

## Content To Hold For Review

These items should not be deleted, but they need owner or design vendor review:

- Final visual assets for `/portfolio/design`
- Whether `/portfolio` needs a landing page in addition to three subpages
- Whether `/success` needs a landing page in addition to two subpages
- Final English slug for `사업계획서/IR`: current recommendation is `/portfolio/business-ir`
- Final English slug for `정부지원사업/정책자금`: current recommendation is `/success/funding`
- Whether old `/projects/*` and `/cases/*` pages remain as thin compatibility pages or pure redirects

## GEO Checks During Implementation

For every moved or merged page:

- Preserve or rewrite `title`
- Preserve or rewrite `description`
- Set canonical to the final page URL
- Keep Breadcrumb schema aligned with the visible menu
- Keep Service schema on service pages
- Keep Article schema on news and columns
- Keep FAQ schema where visible FAQ content remains
- Update sitemap to include new final URLs
- Keep redirects for old public URLs
- Keep `/news/[slug]` and `/columns/[slug]` stable

## First-Pass Acceptance Criteria

The content migration is ready for implementation when:

- No public content source is marked for deletion.
- Every current public page has a destination.
- Every removed visible menu item has a redirect or merge target.
- Portfolio split rules are accepted.
- Success case split rules are accepted.
- GEO checks are documented for implementation.
