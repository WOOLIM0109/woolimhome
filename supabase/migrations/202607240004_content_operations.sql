create table if not exists public.content_work_items (
  id uuid primary key default gen_random_uuid(),
  channel text not null
    check (channel in ('homepage', 'naver_consulting', 'naver_design')),
  format text not null
    check (format in ('column', 'informational', 'authority', 'portfolio', 'design_insight')),
  title text not null,
  summary text not null default '',
  status text not null default 'topic_candidate'
    check (status in (
      'topic_candidate', 'researching', 'creating', 'review_required',
      'approved', 'naver_ready', 'scheduled', 'published', 'on_hold'
    )),
  source_label text,
  source_reference text,
  scheduled_at timestamptz,
  published_at timestamptz,
  review_note text,
  metadata jsonb not null default '{}'::jsonb,
  schedule_key text unique,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_work_items_queue_idx
  on public.content_work_items (channel, status, scheduled_at, created_at desc);

alter table public.content_work_items
  add column if not exists schedule_key text;

create unique index if not exists content_work_items_schedule_key_idx
  on public.content_work_items (schedule_key)
  where schedule_key is not null;

create table if not exists public.content_review_assets (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  asset_type text not null check (asset_type in ('thumbnail', 'body_image', 'article_preview')),
  public_url text not null,
  sort_order integer not null default 0,
  approved boolean not null default false,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists content_review_assets_item_idx
  on public.content_review_assets (work_item_id, sort_order, created_at);

create table if not exists public.content_source_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null unique,
  source_grade integer not null default 1 check (source_grade between 1 and 3),
  collection_method text not null check (collection_method in ('api', 'rss', 'sitemap', 'page', 'manual')),
  topic_families text[] not null default '{}',
  cadence text not null default 'weekly',
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_source_changes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.content_source_registry(id) on delete cascade,
  canonical_url text not null,
  title text not null,
  fingerprint text not null,
  change_type text not null check (change_type in ('new', 'updated', 'removed')),
  detected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists content_source_changes_fingerprint_idx
  on public.content_source_changes (source_id, fingerprint);

alter table public.content_work_items enable row level security;
alter table public.content_review_assets enable row level security;
alter table public.content_source_registry enable row level security;
alter table public.content_source_changes enable row level security;

revoke all on public.content_work_items from anon, authenticated;
revoke all on public.content_review_assets from anon, authenticated;
revoke all on public.content_source_registry from anon, authenticated;
revoke all on public.content_source_changes from anon, authenticated;

comment on table public.content_work_items is
  'Shared workflow for Woolim website columns and two Naver blogs.';
comment on table public.content_review_assets is
  'Only finished JPG/PNG/article previews shown to the operator for review.';
comment on table public.content_source_registry is
  'Official and approved sources used to continuously expand consulting topics.';

insert into public.content_source_registry
  (name, base_url, source_grade, collection_method, topic_families, cadence)
values
  ('기업마당', 'https://www.bizinfo.go.kr', 1, 'page', array['정부지원사업', '기업지원'], 'daily'),
  ('중소벤처기업부', 'https://www.mss.go.kr', 1, 'page', array['중소기업정책', '창업', 'R&D'], 'daily'),
  ('중소벤처기업진흥공단', 'https://www.kosmes.or.kr', 1, 'page', array['정책자금', '수출', '기업성장'], 'daily'),
  ('국가법령정보센터', 'https://www.law.go.kr', 1, 'page', array['법인', '인증', '제도변경'], 'weekly'),
  ('K-Startup', 'https://www.k-startup.go.kr', 1, 'page', array['창업', '사업화', '투자'], 'daily')
on conflict (base_url) do nothing;
