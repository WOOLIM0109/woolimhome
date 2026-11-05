-- 같은 대표의 여러 명의를 한 줄로 접는다. 판정 규칙 판 4 → 5.
--
-- 경동종합상사는 박선영 대표 명의로 사업자가 5개(법인 1·개인 4), 이엘그룹은
-- 4개다. 대표자가 같아 특수관계이고 한 공고에 여러 명의로 신청하지 않는다.
-- 접지 않으면 한 공고에 같은 고객사가 5줄로 뜨고, 후보 수로 순위를 매기니
-- 경동이 걸리는 공고가 전부 위로 올라간다.
--
-- 이 파일이 하는 일은 **판을 올리는 것 하나뿐**이다. 새 칸은 없다 —
-- 명의 묶음은 이미 `openchat_program_customer_profiles.customer_id` 가
-- 들고 있고, 명의는 그 밑의 `entity_key` 다. 공고가 스스로 "대표자가 같으면
-- 한 명의만" 이라고 적어 둔 문장(`exclusion_rules`)은 요건 JSON 에 제약이
-- 없어 손댈 것이 없다.
--
-- 판을 올리면 이미 추출해 둔 공고를 **추출 없이 매칭만** 다시 한다
-- (유료 호출 없음).

-- 판이 올라간 공고는 **추출을 다시 하지 않고 매칭만** 다시 한다.
create or replace function public.save_openchat_program_matches(p_program_id uuid,p_review_date date,p_input_hash text,p_matches jsonb,p_profile_revision bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare current_revision bigint;
begin
  select revision into current_revision from public.openchat_program_match_context where id='current' for share;
  if p_profile_revision is null or current_revision is distinct from p_profile_revision then
    raise exception 'Profile snapshot changed' using errcode='40001';
  end if;
  perform public.save_openchat_program_matches(p_program_id,p_review_date,p_input_hash,p_matches);
  update public.openchat_program_requirements set matched_profile_revision=p_profile_revision,matched_rule_version=5
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
        or r.matched_profile_revision is distinct from (select revision from public.openchat_program_match_context where id='current')
        or r.matched_rule_version<5
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
        or r.matched_rule_version<5
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
