-- Preserve the existing review ranking and publication flow; only changed selection flags are written.
-- Completion markers make a canonical-success/match-save failure resumable without another model call.
-- CREATE OR REPLACE retains service-only ACLs; original three-argument work and claim RPCs stay unchanged.
alter table public.openchat_program_requirements
  add column matched_normalization_version integer not null default 0,
  add column matched_review_date date,
  add column matched_source_checked_at timestamptz;

create or replace function public.save_openchat_program_matches(p_program_id uuid, p_review_date date, p_input_hash text, p_matches jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:' || p_program_id::text, 0));
  if not exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and input_hash=p_input_hash and status='extracted') then raise exception 'Stale requirements'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_review_date::text, 0));
  insert into public.openchat_program_matches
    (program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date)
    select p_program_id,m->>'targetKind',m->>'targetId',m->>'targetName',m->>'verdict',
      m->'reasons',(m->>'score')::numeric,p_review_date
    from pg_catalog.jsonb_array_elements(p_matches) m
    on conflict(program_id,target_kind,target_id,review_date) do update set
      target_name=excluded.target_name,verdict=excluded.verdict,reasons=excluded.reasons,
      score=excluded.score;
  delete from public.openchat_program_matches m where m.program_id=p_program_id
    and m.review_date=p_review_date and not exists
      (select 1 from pg_catalog.jsonb_array_elements(p_matches) x
        where x->>'targetKind'=m.target_kind and x->>'targetId'=m.target_id);
  with selected_programs as materialized (
    select x.program_id from public.openchat_program_matches x
    join public.openchat_programs p on p.id=x.program_id
    where x.review_date=p_review_date and x.verdict <> 'mismatch' and p.status <> 'excluded'
      and (p.deadline_at is null or p.deadline_at >= now())
    group by x.program_id order by max(x.score) desc,x.program_id limit 8
  ), expected_selection as (
    select m.id,(m.verdict <> 'mismatch' and exists (
      select 1 from selected_programs chosen where chosen.program_id=m.program_id
    )) as selected
    from public.openchat_program_matches m where m.review_date=p_review_date
  )
  update public.openchat_program_matches m set selected_for_reading=expected.selected
  from expected_selection expected where m.id=expected.id
    and m.selected_for_reading is distinct from expected.selected;
  -- Commit the completion marker only after target rows and selection both succeed.
  -- A timed-out transaction leaves the old marker due even when old matches exist.
  update public.openchat_program_requirements
    set matched_normalization_version=normalization_version,matched_review_date=p_review_date,
      matched_source_checked_at=source_checked_at
    where program_id=p_program_id and input_hash=p_input_hash and status='extracted';
end;
$$;

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
      or(r.status='extracted' and r.normalization_version<3)
      or(r.status='extracted' and (r.matched_normalization_version is distinct from r.normalization_version
        or r.matched_review_date is distinct from p_review_date
        or r.matched_source_checked_at is distinct from r.source_checked_at
        or not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date)))
      or(r.status='processing' and r.attempted_at<now()-interval '10 minutes'))
  order by case when r.status='extracted' and r.normalization_version<3 then 0 else 1 end,
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
        or(r.status='extracted' and r.normalization_version<3)
      or(r.status='extracted' and (r.matched_normalization_version is distinct from r.normalization_version
        or r.matched_review_date is distinct from p_review_date
        or r.matched_source_checked_at is distinct from r.source_checked_at
        or not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date)))
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
