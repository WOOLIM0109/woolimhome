-- 분야 축을 넣는다. 판정이 '누가 낼 수 있나' 만 묻고 '무엇에 관한 사업인가' 를
-- 묻지 않아서, 고객사 13곳이 LG디스플레이 공고에 전원 후보로 올라왔다 (2026-11-03 실측).
--
-- 이 파일이 하는 일은 두 가지다.
--   1. 고객사·자사 요건에 `item_fields` / `item_not_fields` 두 칸을 허용한다.
--      - item_fields     : 무엇을 만들고 파는지. 분야 키워드
--      - item_not_fields : **확실히** 아닌 분야. 애매하면 비운다
--      빈칸을 부적합으로 쓰지 않는다 — 비어 있으면 분야로 거르지 않고 '확인 필요' 로 둔다.
--   2. 판정 규칙 판을 3 → 4 로 올린다. 규칙이 바뀌었으니 이미 추출해 둔 공고를
--      **추출 없이 매칭만** 다시 하게 만든다 (유료 호출 없음).
--
-- 요건(`openchat_program_requirements.requirements`)에는 제약이 없어서 공고 쪽
-- 새 칸(`support_fields`, `support_field_required`)은 손댈 것이 없다.

-- 1. 요건 칸 두 개 허용 -------------------------------------------------------
-- create or replace 라 기존 권한은 그대로 유지된다.
create or replace function public.valid_openchat_self_profile_patch(p_patch jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare item record; kind text;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then return false; end if;
  for item in select key,value from pg_catalog.jsonb_each(p_patch) loop
    kind:=jsonb_typeof(item.value);
    if item.key not in ('region','founded_on','business_type','industries','employees','revenue_krw','revenue_band',
      'certifications','certifications_complete','has_support_history','notes',
      'item_fields','item_not_fields') then return false; end if;
    if item.key in ('certifications_complete','has_support_history') then
      if kind<>'boolean' then return false; end if;
    elsif kind='null' then continue;
    elsif item.key in ('industries','certifications','item_fields','item_not_fields') then
      if kind<>'array' then return false; end if;
      if jsonb_array_length(item.value)>100 or exists(select 1 from pg_catalog.jsonb_array_elements(item.value) v
        where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200) then return false; end if;
    elsif item.key in ('employees','revenue_krw') then
      if kind<>'number' then return false; end if;
      if (item.value#>>'{}')::numeric<0 or (item.value#>>'{}')::numeric>9007199254740991
        or (item.value#>>'{}')::numeric<>trunc((item.value#>>'{}')::numeric) then return false; end if;
    elsif kind<>'string' then return false;
    elsif length(item.value#>>'{}')<1 or length(item.value#>>'{}')>(case when item.key='notes' then 4000 else 200 end) then return false;
    elsif item.key='founded_on' and (item.value#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' then return false;
    end if;
  end loop;
  return true;
end;
$$;

-- 2. 규칙 판 3 → 4 ------------------------------------------------------------
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
  update public.openchat_program_requirements set matched_profile_revision=p_profile_revision,matched_rule_version=4
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
        or r.matched_rule_version<4
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
        or r.matched_rule_version<4
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
