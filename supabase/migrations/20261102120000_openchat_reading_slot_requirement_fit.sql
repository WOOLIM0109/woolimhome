-- 하루 정독 8칸을 **고객사 요건이 확인된 공고**부터 채운다.
--
-- 점수만 보고 8개를 골랐고, 그 점수는 '마감 여유 7일 이상 +5' 와 '과거 지원사업
-- 이력 +5' 로 아무 공고나 10점이 됐다. 둘 다 공고와 고객사가 맞는지와 무관하다.
-- 그래서 확정 후보 9곳인 공고가 확정 0곳인 10점 공고들에 밀려 목록에서 빠졌다.
-- 점수는 요건 일치만 세도록 바꾸고(matching.ts), 고르는 순서는 확정 후보 수를
-- 먼저 본다. 규칙 판(matched_rule_version)을 3으로 올려 기존 공고를 다시 맞춘다
-- — 추출 결과는 그대로 쓰므로 유료 호출은 늘지 않는다.

create or replace function public.save_openchat_program_matches(p_program_id uuid, p_review_date date, p_input_hash text, p_matches jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare selected_program_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:' || p_program_id::text, 0));
  if not exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and input_hash=p_input_hash and status='extracted') then raise exception 'Stale requirements'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_review_date::text, 0));
  insert into public.openchat_program_matches as existing
    (program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date)
    select p_program_id,m->>'targetKind',m->>'targetId',m->>'targetName',m->>'verdict',
      m->'reasons',(m->>'score')::numeric,p_review_date
    from pg_catalog.jsonb_array_elements(p_matches) m
    on conflict(program_id,target_kind,target_id,review_date) do update set
      target_name=excluded.target_name,verdict=excluded.verdict,reasons=excluded.reasons,
      score=excluded.score
    where (existing.target_name,existing.verdict,existing.reasons,existing.score)
      is distinct from (excluded.target_name,excluded.verdict,excluded.reasons,excluded.score);
  -- Shred the full payload once, instead of once for each of the program's target rows.
  with expected_targets as materialized (
    select x."targetKind" as target_kind,x."targetId" as target_id
    from pg_catalog.jsonb_to_recordset(p_matches) as x("targetKind" text,"targetId" text)
  )
  delete from public.openchat_program_matches m where m.program_id=p_program_id
    and m.review_date=p_review_date and not exists (
      select 1 from expected_targets expected
      where expected.target_kind=m.target_kind and expected.target_id=m.target_id
    );
  select coalesce(array_agg(chosen.program_id),'{}'::uuid[]) into selected_program_ids
  from (
    select x.program_id from public.openchat_program_matches x
    join public.openchat_programs p on p.id=x.program_id
    where x.review_date=p_review_date and x.verdict <> 'mismatch' and p.status <> 'excluded'
      and (p.deadline_at is null or p.deadline_at >= now())
    -- 요건이 확인된 공고가 먼저다. 점수만 보고 고르면, 요건이 하나도 확인되지
    -- 않은 공고가 여러 고객사의 요건이 확정된 공고를 8칸에서 밀어낸다.
    -- '조건부 후보:' 머리말은 matchVerdictLabel() 과 같은 규칙이다.
    group by x.program_id
    order by count(*) filter(where x.verdict='candidate' and not exists(
        select 1 from pg_catalog.jsonb_array_elements_text(x.reasons) as r(reason)
        where r.reason like '조건부 후보:%')) desc,
      max(x.score) desc,x.program_id
    limit 8
  ) chosen;
  -- Touch only old selected rows that leave the set, and new selected rows.
  -- No full-day expected-selection self join or all-row flag rewrite is needed.
  update public.openchat_program_matches m set selected_for_reading=false
    where m.review_date=p_review_date and m.selected_for_reading
      and (m.verdict='mismatch' or not(m.program_id=any(selected_program_ids)));
  update public.openchat_program_matches m set selected_for_reading=true
    where m.review_date=p_review_date and m.program_id=any(selected_program_ids)
      and m.verdict <> 'mismatch' and not m.selected_for_reading;
  -- Commit the completion marker only after target rows and selection both succeed.
  -- A timed-out transaction leaves the old marker due even when old matches exist.
  update public.openchat_program_requirements
    set matched_normalization_version=normalization_version,matched_review_date=p_review_date,
      matched_source_checked_at=source_checked_at
    where program_id=p_program_id and input_hash=p_input_hash and status='extracted';
end;
$$;

create or replace function public.save_openchat_program_matches(p_program_id uuid,p_review_date date,p_input_hash text,p_matches jsonb,p_profile_revision bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare current_revision bigint;
begin
  select revision into current_revision from public.openchat_program_match_context where id='current' for share;
  if p_profile_revision is null or current_revision is distinct from p_profile_revision then
    raise exception 'Profile snapshot changed' using errcode='40001';
  end if;
  perform public.save_openchat_program_matches(p_program_id,p_review_date,p_input_hash,p_matches);
  update public.openchat_program_requirements set matched_profile_revision=p_profile_revision,matched_rule_version=3
    where program_id=p_program_id and input_hash=p_input_hash and status='extracted';
end;
$$;

-- 규칙 판이 올라간 공고는 추출을 다시 하지 않고 매칭만 다시 한다.
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
        or r.matched_profile_revision is distinct from (select revision from public.openchat_program_match_context where id='current')
        or r.matched_rule_version<3
        or not exists(select 1 from public.openchat_program_matches m where m.program_id=p.id and m.review_date=p_review_date)))
      or(r.status='processing' and r.attempted_at<now()-interval '10 minutes'))
  order by case when r.status='extracted' then 0 else 1 end,
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
        or r.matched_profile_revision is distinct from (select revision from public.openchat_program_match_context where id='current')
        or r.matched_rule_version<3
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
