-- Apply before the matching application deployment. All schema changes are
-- additive so the currently deployed application remains compatible.

alter table public.content_work_items
  add column if not exists published_url text,
  add column if not exists published_url_normalized text,
  add column if not exists published_account text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_context jsonb not null default '{}'::jsonb;

update public.content_work_items
set published_url = nullif(trim(metadata #>> '{partnerHandoff,publishedUrl}'), '')
where published_url is null
  and nullif(trim(metadata #>> '{partnerHandoff,publishedUrl}'), '') is not null;

update public.content_work_items
set published_url_normalized = case
  when published_url ~* '^https://(?:m[.])?blog[.]naver[.]com/[a-z0-9_.-]+/[0-9]+(?:[/?#]|$)'
    then 'https://blog.naver.com/'
      || lower(substring(published_url from '(?i)^https://(?:m[.])?blog[.]naver[.]com/([a-z0-9_.-]+)'))
      || '/'
      || substring(published_url from '(?i)^https://(?:m[.])?blog[.]naver[.]com/[a-z0-9_.-]+/([0-9]+)')
  when published_url ~* '^https://(?:m[.])?blog[.]naver[.]com/PostView[.]naver'
    and published_url ~* '[?&]blogId=[a-z0-9_.-]+'
    and published_url ~* '[?&]logNo=[0-9]+'
    then 'https://blog.naver.com/'
      || lower(substring(published_url from '(?i)[?&]blogId=([a-z0-9_.-]+)'))
      || '/'
      || substring(published_url from '(?i)[?&]logNo=([0-9]+)')
  else null
end
where published_url_normalized is null
  and published_url is not null;

update public.content_work_items
set published_account = lower(substring(
  published_url_normalized from '^https://blog[.]naver[.]com/([^/?#]+)'
))
where published_account is null
  and published_url_normalized ~* '^https://blog[.]naver[.]com/[^/?#]+';

-- Preserve the oldest publication as the canonical owner. Later legacy
-- duplicates remain visible but are flagged instead of being deleted.
with ranked as (
  select
    id,
    row_number() over (
      partition by published_url_normalized
      order by published_at asc nulls last, created_at asc, id asc
    ) as duplicate_rank
  from public.content_work_items
  where published_url_normalized is not null
)
update public.content_work_items wi
set
  published_url_normalized = null,
  metadata = coalesce(wi.metadata, '{}'::jsonb) || jsonb_build_object(
    'publicationValidation', jsonb_build_object(
      'duplicateLegacyUrl', true,
      'detectedAt', now()
    )
  ),
  updated_at = now()
from ranked r
where wi.id = r.id
  and r.duplicate_rank > 1;

create unique index if not exists content_work_items_published_url_unique_idx
  on public.content_work_items (published_url_normalized)
  where published_url_normalized is not null;

create index if not exists content_work_items_retry_due_idx
  on public.content_work_items (next_retry_at, channel, status)
  where next_retry_at is not null;

create table if not exists public.content_publication_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  channel text not null,
  event_type text not null check (event_type in ('published', 'duplicate_blocked', 'account_blocked', 'corrected')),
  published_url_normalized text,
  published_account text,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_publication_events_item_idx
  on public.content_publication_events (work_item_id, created_at desc);

alter table public.content_publication_events enable row level security;
revoke all on public.content_publication_events from anon, authenticated;

alter table public.content_jobs
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists retry_backoff_seconds integer,
  add column if not exists last_retry_at timestamptz;

create index if not exists content_jobs_retry_due_idx
  on public.content_jobs (next_retry_at, job_type, status)
  where next_retry_at is not null;

alter table public.column_generation_runs
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_code text;

create index if not exists column_generation_runs_retry_due_idx
  on public.column_generation_runs (next_retry_at, status)
  where next_retry_at is not null;

alter table public.content_workers
  add column if not exists font_inventory_fingerprint text;

alter table public.portfolio_candidates
  add column if not exists missing_fonts text[] not null default '{}',
  add column if not exists font_retry_fingerprint text;

create table if not exists public.content_automation_runs (
  id uuid primary key default gen_random_uuid(),
  cron_name text not null,
  schedule_key text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'skipped')),
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  completed_at timestamptz,
  error_code text,
  error_message text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cron_name, schedule_key)
);

create index if not exists content_automation_runs_recent_idx
  on public.content_automation_runs (scheduled_for desc, cron_name);

alter table public.content_automation_runs enable row level security;
revoke all on public.content_automation_runs from anon, authenticated;

create or replace function public.claim_content_automation_run(
  p_cron_name text,
  p_schedule_key text,
  p_scheduled_for timestamptz,
  p_lease_seconds integer default 600
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 600), 3600));
begin
  if nullif(trim(p_cron_name), '') is null or nullif(trim(p_schedule_key), '') is null then
    raise exception 'Cron name and schedule key are required';
  end if;

  insert into public.content_automation_runs (
    cron_name, schedule_key, status, scheduled_for, started_at, lease_expires_at, updated_at
  ) values (
    p_cron_name,
    p_schedule_key,
    'running',
    p_scheduled_for,
    v_now,
    v_now + make_interval(secs => v_lease_seconds),
    v_now
  )
  on conflict (cron_name, schedule_key) do update
  set
    status = 'running',
    started_at = v_now,
    lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
    completed_at = null,
    error_code = null,
    error_message = null,
    updated_at = v_now
  where public.content_automation_runs.status in ('failed', 'skipped')
     or (
       public.content_automation_runs.status = 'running'
       and public.content_automation_runs.lease_expires_at <= v_now
     )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_content_automation_run(text, text, timestamptz, integer) from public;
revoke all on function public.claim_content_automation_run(text, text, timestamptz, integer) from anon, authenticated;
grant execute on function public.claim_content_automation_run(text, text, timestamptz, integer) to service_role;

comment on column public.content_work_items.published_url_normalized is
  'Server-normalized canonical Naver post URL. A partial unique index prevents reuse.';
comment on table public.content_automation_runs is
  'Actual cron invocation history and overlap lease used by the operations dashboard.';
