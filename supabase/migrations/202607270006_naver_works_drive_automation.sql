create table if not exists public.naver_works_connections (
  id text primary key default 'primary' check (id = 'primary'),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'expired', 'error')),
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_by text,
  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.naver_works_drive_roots (
  id uuid primary key default gen_random_uuid(),
  connection_id text not null default 'primary'
    references public.naver_works_connections(id) on delete cascade,
  drive_type text not null default 'my_drive'
    check (drive_type in ('my_drive', 'shared_drive', 'shared_folder', 'group_folder')),
  external_drive_id text,
  root_file_id text,
  display_name text not null,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.naver_works_drive_files (
  id uuid primary key default gen_random_uuid(),
  root_id uuid references public.naver_works_drive_roots(id) on delete cascade,
  external_file_id text not null,
  parent_file_id text,
  file_path text not null default '',
  file_name text not null,
  file_extension text,
  file_type text not null,
  file_size bigint not null default 0,
  modified_at timestamptz,
  fingerprint text not null,
  supported boolean not null default false,
  sync_status text not null default 'indexed'
    check (sync_status in ('indexed', 'queued', 'downloaded', 'converted', 'ignored', 'error')),
  raw_metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (root_id, external_file_id)
);

create index if not exists naver_works_drive_files_candidate_idx
  on public.naver_works_drive_files (supported, sync_status, modified_at desc);

create table if not exists public.portfolio_candidates (
  id uuid primary key default gen_random_uuid(),
  drive_file_id uuid not null references public.naver_works_drive_files(id) on delete cascade,
  project_key text not null,
  project_name text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'selected', 'excluded', 'on_hold', 'processed')),
  quality_score numeric(5,2) not null default 0,
  duplicate_score numeric(5,2) not null default 0,
  privacy_risk text not null default 'unknown'
    check (privacy_risk in ('unknown', 'low', 'medium', 'high')),
  font_status text not null default 'unchecked'
    check (font_status in ('unchecked', 'ready', 'missing', 'substitution_approved')),
  selection_reasons text[] not null default '{}',
  exclusion_reasons text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drive_file_id)
);

create table if not exists public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.portfolio_candidates(id) on delete cascade,
  work_item_id uuid references public.content_work_items(id) on delete set null,
  job_type text not null
    check (job_type in ('download', 'convert', 'font_check', 'privacy_check', 'mockup', 'draft')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'on_hold', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_jobs_queue_idx
  on public.content_jobs (status, job_type, created_at);

alter table public.naver_works_connections enable row level security;
alter table public.naver_works_drive_roots enable row level security;
alter table public.naver_works_drive_files enable row level security;
alter table public.portfolio_candidates enable row level security;
alter table public.content_jobs enable row level security;

revoke all on public.naver_works_connections from anon, authenticated;
revoke all on public.naver_works_drive_roots from anon, authenticated;
revoke all on public.naver_works_drive_files from anon, authenticated;
revoke all on public.portfolio_candidates from anon, authenticated;
revoke all on public.content_jobs from anon, authenticated;

insert into public.naver_works_connections (id, status)
values ('primary', 'disconnected')
on conflict (id) do nothing;

comment on table public.naver_works_connections is
  'Server-only OAuth token state for NAVER WORKS Drive. Tokens are encrypted before storage.';
comment on table public.naver_works_drive_files is
  'Read-only index of files discovered in approved NAVER WORKS Drive roots.';
comment on table public.portfolio_candidates is
  'Scored portfolio candidates selected from indexed Drive project files.';
comment on table public.content_jobs is
  'Asynchronous download, conversion, inspection, mockup and draft job queue.';
