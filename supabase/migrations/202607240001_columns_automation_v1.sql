create extension if not exists pgcrypto;

create table if not exists public.column_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null,
  tags text[] not null default '{}',
  category text,
  content_kind text not null default 'informational'
    check (content_kind in ('informational', 'hybrid', 'authority')),
  audience text,
  core_message text,
  published boolean not null default false,
  published_at timestamptz,
  scheduled_at timestamptz,
  generation_status text not null default 'draft'
    check (generation_status in ('draft', 'generated', 'needs_expert_input', 'reviewed')),
  generation_metadata jsonb not null default '{}'::jsonb,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists column_posts_publication_idx
  on public.column_posts (published, published_at desc, created_at desc);
create index if not exists column_posts_tags_idx
  on public.column_posts using gin (tags);

create table if not exists public.column_generation_runs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.column_posts(id) on delete set null,
  status text not null check (status in ('started', 'generated', 'blocked', 'failed')),
  model text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  error_message text,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.column_editorial_feedback (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.column_posts(id) on delete cascade,
  generation_run_id uuid references public.column_generation_runs(id) on delete set null,
  reviewer_email text not null,
  decision text not null check (decision in ('edited', 'approved', 'rejected')),
  reason_codes text[] not null default '{}',
  before_payload jsonb not null default '{}'::jsonb,
  after_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.column_expert_knowledge (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  source_type text not null check (source_type in ('interview', 'case', 'note')),
  raw_text text not null,
  perspective text,
  case_evidence text,
  differentiator text,
  approved boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.column_posts enable row level security;
alter table public.column_generation_runs enable row level security;
alter table public.column_editorial_feedback enable row level security;
alter table public.column_expert_knowledge enable row level security;

drop policy if exists "Published columns are publicly readable" on public.column_posts;
create policy "Published columns are publicly readable"
  on public.column_posts for select
  using (published = true and published_at is not null and published_at <= now());

revoke all on public.column_generation_runs from anon, authenticated;
revoke all on public.column_editorial_feedback from anon, authenticated;
revoke all on public.column_expert_knowledge from anon, authenticated;

comment on table public.column_expert_knowledge is
  'Approved interview, case, and operator knowledge used for differentiated Woolim columns.';
