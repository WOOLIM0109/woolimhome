alter table public.content_jobs
  drop constraint if exists content_jobs_status_check;

alter table public.content_jobs
  add constraint content_jobs_status_check
  check (status in (
    'queued', 'running', 'completed', 'on_hold', 'failed',
    'pc_waiting', 'pc_running'
  ));

create table if not exists public.content_workers (
  id text primary key,
  display_name text not null,
  status text not null default 'offline'
    check (status in ('online', 'busy', 'offline', 'error')),
  current_job_id uuid references public.content_jobs(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_workers enable row level security;
revoke all on public.content_workers from anon, authenticated;

create index if not exists content_workers_last_seen_idx
  on public.content_workers (last_seen_at desc);

update public.content_jobs
set
  status = 'pc_waiting',
  attempts = least(attempts, 3),
  error_message = null,
  completed_at = null,
  updated_at = now()
where job_type = 'convert'
  and status = 'failed'
  and (
    error_message ilike '%READ_ONLY_FONTS%'
    or error_message ilike '%read-only fonts%'
  );

update public.content_work_items wi
set
  status = 'researching',
  summary = '제한 글꼴을 원본 그대로 유지하기 위해 회사 PC의 PowerPoint 변환을 기다리고 있습니다.',
  review_note = null,
  updated_at = now()
where exists (
  select 1
  from public.content_jobs j
  where j.work_item_id = wi.id
    and j.job_type = 'convert'
    and j.status = 'pc_waiting'
);

update public.portfolio_candidates c
set
  status = 'on_hold',
  updated_at = now()
where exists (
  select 1
  from public.content_jobs j
  where j.candidate_id = c.id
    and j.job_type = 'convert'
    and j.status = 'pc_waiting'
);

comment on table public.content_workers is
  'Heartbeat and current state of trusted on-premise PowerPoint conversion workers.';
