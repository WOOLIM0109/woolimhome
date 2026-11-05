-- Rolling deployment order: apply this migration before deploying the new API.
-- The trigger below supplies a legacy identity and two-hour lease when the old
-- single-worker API changes a conversion to pc_running without claim columns.
-- Keep PC_WORKER_ALLOW_LEGACY enabled until the home PC runs the updated worker.

alter table public.content_jobs
  add column if not exists claimed_by_worker_id text,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz;

-- This row must exist even when there is no conversion running at migration
-- time, because the old API can claim its first job after the DB deploy.
insert into public.content_workers (id, display_name, status, last_seen_at, updated_at)
values ('becky-office-pc', '울림 집 PC (기존)', 'offline', now(), now())
on conflict (id) do update
set
  display_name = excluded.display_name,
  updated_at = now();

-- Preserve any conversion already running under the original single-worker
-- deployment. The worker ID was previously stored only in result JSON.
insert into public.content_workers (id, display_name, status, last_seen_at, updated_at)
select distinct
  coalesce(nullif(j.result ->> 'pcWorkerId', ''), 'becky-office-pc'),
  case
    when coalesce(nullif(j.result ->> 'pcWorkerId', ''), 'becky-office-pc') = 'becky-office-pc'
      then '울림 집 PC (기존)'
    else coalesce(nullif(j.result ->> 'pcWorkerId', ''), 'becky-office-pc')
  end,
  'busy',
  now(),
  now()
from public.content_jobs j
where j.job_type = 'convert'
  and j.status = 'pc_running'
on conflict (id) do nothing;

update public.content_workers
set
  display_name = '울림 집 PC (기존)',
  updated_at = now()
where id = 'becky-office-pc';

update public.content_jobs
set
  claimed_by_worker_id = coalesce(
    nullif(result ->> 'pcWorkerId', ''),
    'becky-office-pc'
  ),
  claimed_at = coalesce(started_at, updated_at, now()),
  -- Old workers do not renew a lease, so give in-flight legacy jobs enough
  -- time to finish after this migration is deployed.
  lease_expires_at = now() + interval '2 hours'
where job_type = 'convert'
  and status = 'pc_running'
  and claimed_by_worker_id is null;

update public.content_jobs
set
  claimed_by_worker_id = null,
  claimed_at = null,
  lease_expires_at = null
where status = 'pc_waiting';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_jobs_claimed_by_worker_id_fkey'
      and conrelid = 'public.content_jobs'::regclass
  ) then
    alter table public.content_jobs
      add constraint content_jobs_claimed_by_worker_id_fkey
      foreign key (claimed_by_worker_id)
      references public.content_workers(id)
      on delete set null;
  end if;
end
$$;

create or replace function public.normalize_pc_conversion_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_type <> 'convert' then
    return new;
  end if;

  if new.status = 'pc_running' then
    if new.claimed_by_worker_id is null then
      insert into public.content_workers (
        id, display_name, status, last_seen_at, updated_at
      ) values (
        'becky-office-pc', '울림 집 PC (기존)', 'offline', clock_timestamp(), clock_timestamp()
      ) on conflict (id) do nothing;

      new.claimed_by_worker_id := 'becky-office-pc';
      new.claimed_at := coalesce(new.claimed_at, new.started_at, clock_timestamp());
      new.lease_expires_at := coalesce(
        new.lease_expires_at,
        clock_timestamp() + interval '2 hours'
      );
    end if;
  elsif new.status = 'pc_waiting' then
    new.lease_expires_at := null;
    if new.attempts >= new.max_attempts then
      new.status := 'failed';
      new.error_message := left(concat_ws(
        E'\n',
        nullif(new.error_message, ''),
        format('PC worker retry limit reached (%s/%s).', new.attempts, new.max_attempts)
      ), 1000);
    else
      new.claimed_by_worker_id := null;
      new.claimed_at := null;
    end if;
  else
    -- Keep the owner as audit history on completed/permanent failures, but a
    -- non-running job must never retain an active lease.
    new.lease_expires_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_pc_conversion_claim_trigger
  on public.content_jobs;
create trigger normalize_pc_conversion_claim_trigger
before insert or update of status, claimed_by_worker_id, claimed_at, lease_expires_at
on public.content_jobs
for each row
execute function public.normalize_pc_conversion_claim();

revoke all on function public.normalize_pc_conversion_claim() from public;
revoke all on function public.normalize_pc_conversion_claim() from anon, authenticated;

-- Close already-exhausted waiting rows during migration. Associated work and
-- candidates remain recoverable through the admin requeue flow.
update public.content_jobs
set
  status = 'failed',
  error_message = left(concat_ws(
    E'\n',
    nullif(error_message, ''),
    format('PC worker retry limit reached (%s/%s).', attempts, max_attempts)
  ), 1000),
  updated_at = now()
where job_type = 'convert'
  and status = 'pc_waiting'
  and attempts >= max_attempts;

update public.content_work_items wi
set
  status = 'on_hold',
  summary = '문서 변환 재시도 한도에 도달해 자동 처리를 중단했습니다. 관리자 확인 후 다시 실행해 주세요.',
  review_note = j.error_message,
  updated_at = now()
from public.content_jobs j
where j.work_item_id = wi.id
  and j.job_type = 'convert'
  and j.status = 'failed'
  and j.attempts >= j.max_attempts
  and j.error_message like '%PC worker retry limit reached%';

update public.portfolio_candidates c
set status = 'on_hold', updated_at = now()
from public.content_jobs j
where j.candidate_id = c.id
  and j.job_type = 'convert'
  and j.status = 'failed'
  and j.attempts >= j.max_attempts
  and j.error_message like '%PC worker retry limit reached%'
  and c.status in ('candidate', 'selected', 'on_hold');

create index if not exists content_jobs_pc_lease_queue_idx
  on public.content_jobs (job_type, status, lease_expires_at, created_at)
  where job_type = 'convert';

create index if not exists content_jobs_active_worker_idx
  on public.content_jobs (claimed_by_worker_id, lease_expires_at)
  where status = 'pc_running'
    and claimed_by_worker_id is not null;

create or replace function public.claim_next_pc_conversion_job(
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns setof public.content_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.content_jobs%rowtype;
  v_job_id uuid;
  v_previous_worker_id text;
  v_exhausted record;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 86400));
begin
  if p_worker_id is null or not exists (
    select 1 from public.content_workers where id = p_worker_id
  ) then
    raise exception 'Unknown content worker';
  end if;

  -- Serialize duplicate claim requests from one worker while still allowing
  -- different PCs to claim separate rows concurrently.
  perform pg_advisory_xact_lock(hashtext('content-worker:' || p_worker_id));

  -- Repair a job created by the old API during a DB-first rolling deployment.
  -- The compatibility trigger normally handles this at write time; this is a
  -- second guard for rows created while the trigger was being installed.
  insert into public.content_workers (
    id, display_name, status, last_seen_at, updated_at
  ) values (
    'becky-office-pc', '울림 집 PC (기존)', 'offline', v_now, v_now
  ) on conflict (id) do nothing;

  update public.content_jobs
  set
    claimed_by_worker_id = 'becky-office-pc',
    claimed_at = coalesce(claimed_at, started_at, updated_at, v_now),
    lease_expires_at = coalesce(lease_expires_at, v_now + interval '2 hours'),
    updated_at = v_now
  where job_type = 'convert'
    and status = 'pc_running'
    and claimed_by_worker_id is null;

  -- A retryable failure is allowed at most max_attempts claims. Waiting jobs
  -- and expired leases at the limit become recoverable admin holds instead of
  -- being assigned forever.
  for v_exhausted in
    with exhausted as (
      update public.content_jobs
      set
        status = 'failed',
        lease_expires_at = null,
        error_message = left(concat_ws(
          E'\n',
          nullif(error_message, ''),
          format('PC worker retry limit reached (%s/%s).', attempts, max_attempts)
        ), 1000),
        updated_at = v_now
      where job_type = 'convert'
        and attempts >= max_attempts
        and (
          status = 'pc_waiting'
          or (
            status = 'pc_running'
            and lease_expires_at is not null
            and lease_expires_at <= v_now
          )
        )
      returning work_item_id, candidate_id, error_message
    )
    select * from exhausted
  loop
    if v_exhausted.work_item_id is not null then
      update public.content_work_items
      set
        status = 'on_hold',
        summary = '문서 변환 재시도 한도에 도달해 자동 처리를 중단했습니다. 관리자 확인 후 다시 실행해 주세요.',
        review_note = v_exhausted.error_message,
        updated_at = v_now
      where id = v_exhausted.work_item_id;
    end if;

    if v_exhausted.candidate_id is not null then
      update public.portfolio_candidates
      set status = 'on_hold', updated_at = v_now
      where id = v_exhausted.candidate_id
        and status in ('candidate', 'selected', 'on_hold');
    end if;
  end loop;

  -- A retry after a lost HTTP response should resume the same job instead of
  -- assigning a second one to the same PC.
  select *
  into v_job
  from public.content_jobs
  where job_type = 'convert'
    and status = 'pc_running'
    and claimed_by_worker_id = p_worker_id
    and lease_expires_at > v_now
  order by claimed_at asc nulls first
  limit 1
  for update;

  if found then
    update public.content_jobs
    set
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      updated_at = v_now
    where id = v_job.id
    returning * into v_job;
    return next v_job;
    return;
  end if;

  select id, claimed_by_worker_id
  into v_job_id, v_previous_worker_id
  from public.content_jobs
  where job_type = 'convert'
    and (
      (status = 'pc_waiting' and attempts < max_attempts)
      or (
        status = 'pc_running'
        and lease_expires_at is not null
        and lease_expires_at <= v_now
        and attempts < max_attempts
      )
    )
  order by created_at asc
  limit 1
  for update skip locked;

  if v_job_id is null then
    return;
  end if;

  if v_previous_worker_id is not null and v_previous_worker_id <> p_worker_id then
    update public.content_workers
    set
      status = case when status = 'offline' then status else 'online' end,
      current_job_id = null,
      last_error = 'Job lease expired and was reassigned.',
      updated_at = v_now
    where id = v_previous_worker_id
      and current_job_id = v_job_id;
  end if;

  update public.content_jobs
  set
    status = 'pc_running',
    attempts = attempts + 1,
    started_at = v_now,
    completed_at = null,
    error_message = null,
    claimed_by_worker_id = p_worker_id,
    claimed_at = v_now,
    lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
    result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
      'pcWorkerId', p_worker_id,
      'pcClaimedAt', v_now
    ),
    updated_at = v_now
  where id = v_job_id
  returning * into v_job;

  return next v_job;
end;
$$;

revoke all on function public.claim_next_pc_conversion_job(text, integer) from public;
revoke all on function public.claim_next_pc_conversion_job(text, integer) from anon, authenticated;
grant execute on function public.claim_next_pc_conversion_job(text, integer) to service_role;

comment on column public.content_jobs.claimed_by_worker_id is
  'Worker that currently owns or most recently completed this PC conversion job.';
comment on column public.content_jobs.lease_expires_at is
  'Exclusive claim deadline. Active workers extend it through heartbeat calls.';
comment on function public.claim_next_pc_conversion_job(text, integer) is
  'Atomically resumes or claims one PC conversion job for a trusted worker.';
