alter table public.openchat_program_requirements add column diagnostics jsonb not null default '{}'::jsonb
  check (jsonb_typeof(diagnostics)='object');
-- Snapshot before source reads; result-save time must not hide mid-call source changes.
alter table public.openchat_program_requirements add column source_checked_at timestamptz;
alter table public.openchat_program_requirement_attempts
  add column response_text text,
  add column diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics)='object'),
  add column responded_at timestamptz;

-- A failed original call remains recorded. An explicit administrator recovery is
-- separately audited and can be consumed only once for the same program/hash.
create table public.openchat_program_requirement_recoveries (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.openchat_programs(id) on delete cascade,
  input_hash text not null,
  reason text not null default '사용자 요청에 따른 실패 공고 수정 검증',
  started_at timestamptz not null default now(),
  response_text text,
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics)='object'),
  responded_at timestamptz,
  unique(program_id,input_hash)
);
create table public.openchat_program_review_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  task text not null check(task in ('attachments','requirements')),
  status text not null default 'running' check(status in ('running','completed','partial','blocked','failed','skipped','interrupted')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_expires_at timestamptz not null default now()+interval '5 minutes',
  summary jsonb not null default '{}'::jsonb check(jsonb_typeof(summary)='object'),
  error_code text
);
create index openchat_program_review_jobs_recent_idx on public.openchat_program_review_jobs(started_at desc);
alter table public.openchat_program_requirement_recoveries enable row level security;
alter table public.openchat_program_review_jobs enable row level security;
revoke all on public.openchat_program_requirement_recoveries,public.openchat_program_review_jobs from public,anon,authenticated;
grant all on public.openchat_program_requirement_recoveries,public.openchat_program_review_jobs to service_role;

create function public.claim_openchat_program_review_job(p_owner uuid,p_task text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare job_id uuid;
begin
  if p_owner is null or p_task is null or p_task not in ('attachments','requirements') then
    raise exception 'Invalid review job';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('program-review-job',0));
  update public.openchat_program_review_jobs set status='interrupted',finished_at=now()
    where status='running' and lease_expires_at<=now();
  if exists(select 1 from public.openchat_program_review_jobs where status='running' and lease_expires_at>now()) then return null; end if;
  insert into public.openchat_program_review_jobs(owner_id,task) values(p_owner,p_task) returning id into job_id;
  return job_id;
end;
$$;
create function public.finish_openchat_program_review_job(p_job_id uuid,p_owner uuid,p_status text,p_summary jsonb,p_error_code text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_status is null or p_status not in ('completed','partial','blocked','failed','skipped')
    or p_summary is null or jsonb_typeof(p_summary)<>'object' or octet_length(p_summary::text)>32768
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$') then raise exception 'Invalid review summary'; end if;
  update public.openchat_program_review_jobs set status=p_status,summary=p_summary,error_code=p_error_code,
    finished_at=now(),lease_expires_at=now() where id=p_job_id and owner_id=p_owner and status='running'
    and lease_expires_at>now();
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
create function public.claim_openchat_requirement_recovery(p_program_id uuid,p_input_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare recovery_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:'||p_program_id::text,0));
  if not exists(select 1 from public.openchat_program_requirements r join public.openchat_programs p on p.id=r.program_id
    where r.program_id=p_program_id and r.input_hash=p_input_hash and r.status='failed'
      and p.created_at>=now()-interval '60 days' and (p.deadline_at is null or p.deadline_at>=now())) then return null; end if;
  insert into public.openchat_program_requirement_recoveries(program_id,input_hash) values(p_program_id,p_input_hash)
    on conflict do nothing returning id into recovery_id;
  if recovery_id is null then return null; end if;
  delete from public.openchat_program_matches where program_id=p_program_id and review_date>=(now() at time zone 'Asia/Seoul')::date;
  update public.openchat_program_requirements set status='processing',requirements=null,error=null,diagnostics='{}'::jsonb,
    attempted_at=now(),extracted_at=null,updated_at=now() where program_id=p_program_id and input_hash=p_input_hash;
  return recovery_id;
end;
$$;
-- Explicit manual test scope includes existing excluded notices, without changing
-- their collection/approval/publication state. Original attachment RPC is unchanged.
create function public.claim_openchat_review_attachment(attachment_id uuid)
returns setof public.openchat_program_attachments language sql security invoker set search_path='' as $$
  update public.openchat_program_attachments a set processing_started_at=now(),attempts=attempts+1
  where a.id=attachment_id and a.text_status in ('pending','failed') and a.attempts<3
    and (a.processing_started_at is null or a.processing_started_at<now()-interval '10 minutes')
    and exists(select 1 from public.openchat_programs p where p.id=a.program_id
      and p.created_at>=now()-interval '60 days' and (p.deadline_at is null or p.deadline_at>=now())) returning a.*;
$$;
create function public.release_openchat_requirement_recovery_budget(p_recovery_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare released record;
begin
  delete from public.openchat_program_requirement_recoveries where id=p_recovery_id and responded_at is null
    returning program_id,input_hash into released;
  if released is not null then
    update public.openchat_program_requirements set status='failed',error='복구 호출 전 예산·시간 보류',
      diagnostics=jsonb_build_object('stage','before_call','code','RECOVERY_DEFERRED'),updated_at=now()
      where program_id=released.program_id and input_hash=released.input_hash and status='processing';
  end if;
end;
$$;

-- Four-argument overload keeps the deployed three-argument caller compatible
-- while the new build is being staged. No defaults: PostgREST cannot confuse them.
create function public.list_openchat_requirement_work(p_review_date date,p_limit integer,p_program_ids uuid[],p_include_excluded boolean)
returns table(id uuid,deadline_at timestamptz,created_at timestamptz)
language sql security invoker set search_path='' as $$
  select p.id,p.deadline_at,p.created_at from public.openchat_programs p
  left join public.openchat_program_requirements r on r.program_id=p.id
  left join public.openchat_program_attachment_discovery d on d.program_id=p.id
  join lateral(select max(greatest(a.created_at,a.extracted_at,a.processing_started_at)) as touched,
    count(*) filter(where a.text_status='extracted' and length(a.text_content)>0) as extracted
    from public.openchat_program_attachments a where a.program_id=p.id) a on a.extracted>0
  where (p_include_excluded or p.status<>'excluded') and (p.deadline_at is null or p.deadline_at>=now())
    and p.created_at>=now()-interval '60 days' and (p_program_ids is null or p.id=any(p_program_ids))
    and (r.program_id is null or coalesce(r.source_checked_at,r.updated_at)<greatest(d.checked_at,a.touched)
      or(r.status='extracted' and not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date))
      or(r.status='processing' and r.attempted_at<now()-interval '10 minutes'))
  order by p.deadline_at asc nulls last,(r.program_id is null) desc,r.updated_at nulls first,p.created_at desc,p.id
  limit greatest(1,least(coalesce(p_limit,80),100));
$$;
create function public.openchat_review_queue_status(p_review_date date,p_include_excluded boolean)
returns jsonb language sql security invoker set search_path='' as $$
  with facts as (
    select p.id,d.status as discovery_status,r.status as requirement_status,r.updated_at,r.source_checked_at,r.attempted_at,
      d.checked_at,a.touched,coalesce(a.extracted,0) as extracted,
      coalesce(a.chars,0)+coalesce(length(d.detail_text),0) as chars,
      (r.program_id is null or coalesce(r.source_checked_at,r.updated_at)<greatest(d.checked_at,a.touched)
        or(r.status='extracted' and not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date))
        or(r.status='processing' and r.attempted_at<now()-interval '10 minutes')) as due
    from public.openchat_programs p
    left join public.openchat_program_attachment_discovery d on d.program_id=p.id
    left join public.openchat_program_requirements r on r.program_id=p.id
    left join lateral(select max(greatest(a.created_at,a.extracted_at,a.processing_started_at)) as touched,
      count(*) filter(where a.text_status='extracted' and length(a.text_content)>0) as extracted,
      sum(length(a.text_content)) filter(where a.text_status='extracted') as chars
      from public.openchat_program_attachments a where a.program_id=p.id) a on true
    where p.created_at>=now()-interval '60 days' and (p_include_excluded or p.status<>'excluded')
      and (p.deadline_at is null or p.deadline_at>=now())
  ) select jsonb_build_object('eligible',count(*),'withText',count(*) filter(where extracted>0),
    'waitingAttachments',count(*) filter(where extracted=0),
    'requirementsExtracted',count(*) filter(where requirement_status='extracted'),
    'requirementsFailed',count(*) filter(where requirement_status='failed'),
    'ready',count(*) filter(where extracted>0 and due),
    'remaining',count(*) filter(where requirement_status is distinct from 'extracted' or due),
    'pendingInputChars',coalesce(sum(least(60000,chars)) filter(where extracted>0 and due),0)) from facts;
$$;

revoke all on function public.claim_openchat_program_review_job(uuid,text),
  public.finish_openchat_program_review_job(uuid,uuid,text,jsonb,text),public.claim_openchat_requirement_recovery(uuid,text),
  public.claim_openchat_review_attachment(uuid),public.list_openchat_requirement_work(date,integer,uuid[],boolean),
  public.openchat_review_queue_status(date,boolean),public.release_openchat_requirement_recovery_budget(uuid) from public,anon,authenticated;
grant execute on function public.claim_openchat_program_review_job(uuid,text),
  public.finish_openchat_program_review_job(uuid,uuid,text,jsonb,text),public.claim_openchat_requirement_recovery(uuid,text),
  public.claim_openchat_review_attachment(uuid),public.list_openchat_requirement_work(date,integer,uuid[],boolean),
  public.openchat_review_queue_status(date,boolean),public.release_openchat_requirement_recovery_budget(uuid) to service_role;
