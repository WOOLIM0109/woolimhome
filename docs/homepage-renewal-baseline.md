# Homepage Renewal Baseline

This document locks the starting point for the Woolim Company homepage information architecture renewal.

## Baseline

- Repository: `WOOLIM0109/woolimhome`
- Working branch: `information-architecture-renewal`
- Baseline branch: `main`
- Baseline commit: `d8ea7264ae6e8105f2e20c67308f5a41c614deb6`
- Baseline commit message: `외주 작업실은 네이버 주소만으로 발행 완료 처리`
- Baseline commit date: `2026-09-05 18:20:43 +0900`

## Scope

The renewal work focuses on public homepage information architecture.

Included:

- Public navigation
- Public page route mapping
- Content migration
- Redirects from old public URLs to new public URLs
- GEO/SEO preservation

Excluded unless explicitly approved:

- Admin dashboard redesign
- Content automation logic
- Supabase schema changes
- Worker/Cron behavior changes
- Gemini/Naver Works automation changes
- Contact form behavior changes, except verification

## No-Deletion Rule

Existing public content must not be deleted during the first implementation pass.

Default treatment for existing content:

- Move to the new page structure
- Merge into a related page
- Keep at the existing URL
- Hold for owner review

Deletion is allowed only after the content migration map has been reviewed and the replacement location is confirmed.

## GEO Protection Rule

Preserve or intentionally remap these items during renewal:

- Page `metadata`
- Canonical URLs
- `JsonLd` structured data
- `sitemap.xml`
- `robots.txt`
- `llms.txt`
- Existing public URLs via redirects
- Published news and column slugs
- Service, FAQ, award, address, and contact facts

Known technical cleanup candidates:

- Remove or implement the current `/search` target used by `SearchAction`.
- Remove nested `<main>` elements inside public/admin page components where the root layout already provides `<main>`.
- Update production domain environment values before deployment.
