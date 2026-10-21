-- Existing results are version 1. Re-normalize successful results locally before
-- making new paid work; no model prompt/hash or immutable attempt is changed.
alter table public.openchat_program_requirements
  add column normalization_version integer not null default 1;

-- Replace only the manual four-argument work RPC and its queue summary.
-- CREATE OR REPLACE retains the service-only grants; both stay SECURITY INVOKER.
-- The deployed three-argument work RPC and all claim functions remain unchanged.
create or replace function public.list_openchat_requirement_work(p_review_date date,p_limit integer,p_program_ids uuid[],p_include_excluded boolean)
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
      or(r.status='extracted' and r.normalization_version<2)
      or(r.status='extracted' and not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date))
      or(r.status='processing' and r.attempted_at<now()-interval '10 minutes'))
  order by case when r.status='extracted' and r.normalization_version<2 then 0 else 1 end,
    p.deadline_at asc nulls last,(r.program_id is null) desc,r.updated_at nulls first,p.created_at desc,p.id
  limit greatest(1,least(coalesce(p_limit,80),100));
$$;
create or replace function public.openchat_review_queue_status(p_review_date date,p_include_excluded boolean)
returns jsonb language sql security invoker set search_path='' as $$
  with facts as (
    select p.id,d.status as discovery_status,r.status as requirement_status,r.updated_at,r.source_checked_at,r.attempted_at,
      d.checked_at,a.touched,coalesce(a.extracted,0) as extracted,
      coalesce(a.chars,0)+coalesce(length(d.detail_text),0) as chars,
      (r.program_id is null or coalesce(r.source_checked_at,r.updated_at)<greatest(d.checked_at,a.touched)
        or(r.status='extracted' and r.normalization_version<2)
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

