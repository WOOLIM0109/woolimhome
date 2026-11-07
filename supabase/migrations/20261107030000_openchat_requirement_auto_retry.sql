-- 실패로 굳은 공고를 아침 실행이 한 번은 다시 부른다. 2026-11-07.
--
-- 지금 살아 있는 공고 121건 가운데 67건이 'failed' 로 멈춰 있다. 원문은 멀쩡하다
-- — 잘리지도 않았고 첨부도 다 읽혔다. 끊긴 쪽은 답변이다. 2026-11-04 에 요건 칸
-- 하나를 required 에 넣었다가 답변이 한도를 넘겨 줄줄이 실패했고, 스키마를
-- 되돌린 뒤에도 실패 기록은 그대로 남았다.
--
-- 남은 이유는 두 겹이다.
--   1. list_openchat_requirement_work 가 status='failed' 를 아예 줄에 세우지 않는다.
--   2. claim_openchat_requirement 이 같은 원문을 두 번 부르지 않는다
--      (attempts 의 (program_id,input_hash) 유일 제약).
-- 둘 다 돈이 새는 것을 막으려고 일부러 둔 것이다. 없애면 안 된다.
--
-- 그래서 **한 번만** 뚫는다. 실패한 공고마다 자동 재시도를 딱 1회 허용한다.
-- 그 1회를 쓰고 또 실패하면 다시는 자동으로 부르지 않는다. 공고 탓에 실패하는
-- 것에 돈을 계속 태우지 않으려는 것이다. 67건이면 최대 67회, 한 번뿐이다.
--
-- ★ 사람이 부르는 복구 3회와 **칸을 나눈다.**
--   recoveries 에 kind 를 둬서 'auto' 와 'manual' 을 따로 센다. 자동이 3회를
--   먹어 치우면, 버그를 고친 뒤에 사람이 다시 부를 길이 없어진다. 관리 화면의
--   '실패 공고 복구' 는 전과 똑같이 같은 원문에 3회 남아 있어야 한다.
--
-- 하루에 도는 양은 Gemini 자동 호출 상한이 정한다. 67건은 한 아침에 다 돌지
-- 않고 며칠에 걸쳐 나뉜다. 그 편이 안전하다.

alter table public.openchat_program_requirement_recoveries
  add column if not exists kind text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid='public.openchat_program_requirement_recoveries'::regclass
        and conname='openchat_program_requirement_recoveries_kind_check') then
    alter table public.openchat_program_requirement_recoveries
      add constraint openchat_program_requirement_recoveries_kind_check
      check (kind in ('manual','auto'));
  end if;
end $$;
create index if not exists openchat_program_requirement_recoveries_kind_idx
  on public.openchat_program_requirement_recoveries(program_id,input_hash,kind);

-- 사람이 부르는 복구. 'manual' 만 세도록 바꾼다. 상한 3회는 그대로다.
create or replace function public.claim_openchat_requirement_recovery(p_program_id uuid,p_input_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare recovery_id uuid; spent integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:'||p_program_id::text,0));
  if exists(select 1 from public.openchat_program_requirements where program_id=p_program_id
      and status='processing' and attempted_at>now()-interval '10 minutes') then return null; end if;
  if not exists(select 1 from public.openchat_program_requirements r join public.openchat_programs p on p.id=r.program_id
    where r.program_id=p_program_id and r.status='failed'
      and p.created_at>=now()-interval '60 days' and (p.deadline_at is null or p.deadline_at>=now())) then return null; end if;
  select count(*) into spent from public.openchat_program_requirement_recoveries
    where program_id=p_program_id and input_hash=p_input_hash and kind='manual';
  if spent>=3 then return null; end if;
  insert into public.openchat_program_requirement_recoveries(program_id,input_hash,kind)
    values(p_program_id,p_input_hash,'manual') returning id into recovery_id;
  delete from public.openchat_program_matches where program_id=p_program_id and review_date>=(now() at time zone 'Asia/Seoul')::date;
  update public.openchat_program_requirements set input_hash=p_input_hash,status='processing',requirements=null,error=null,
    diagnostics='{}'::jsonb,source_manifest='[]'::jsonb,source_complete=false,input_truncated=false,
    attempted_at=now(),extracted_at=null,updated_at=now() where program_id=p_program_id;
  return recovery_id;
end;
$$;

-- 아침 실행이 부르는 자동 재시도. 같은 원문에 **1회**뿐이다.
-- 몸통은 위 복구와 같다 — 같은 10분 기준, 같은 60일·마감 기준을 쓴다.
create or replace function public.claim_openchat_requirement_auto_retry(p_program_id uuid,p_input_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare recovery_id uuid; spent integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:'||p_program_id::text,0));
  if exists(select 1 from public.openchat_program_requirements where program_id=p_program_id
      and status='processing' and attempted_at>now()-interval '10 minutes') then return null; end if;
  if not exists(select 1 from public.openchat_program_requirements r join public.openchat_programs p on p.id=r.program_id
    where r.program_id=p_program_id and r.status='failed'
      and p.created_at>=now()-interval '60 days' and (p.deadline_at is null or p.deadline_at>=now())) then return null; end if;
  select count(*) into spent from public.openchat_program_requirement_recoveries
    where program_id=p_program_id and input_hash=p_input_hash and kind='auto';
  if spent>=1 then return null; end if;
  insert into public.openchat_program_requirement_recoveries(program_id,input_hash,kind,reason)
    values(p_program_id,p_input_hash,'auto','실패로 남은 공고의 자동 재시도 1회') returning id into recovery_id;
  delete from public.openchat_program_matches where program_id=p_program_id and review_date>=(now() at time zone 'Asia/Seoul')::date;
  update public.openchat_program_requirements set input_hash=p_input_hash,status='processing',requirements=null,error=null,
    diagnostics='{}'::jsonb,source_manifest='[]'::jsonb,source_complete=false,input_truncated=false,
    attempted_at=now(),extracted_at=null,updated_at=now() where program_id=p_program_id;
  return recovery_id;
end;
$$;
-- 새로 만든 함수라 기본값이 '누구나 실행' 이다. 이 저장소의 다른 요건 함수와
-- 같게 서비스 역할만 부른다. create or replace 로 고친 함수들은 권한이 그대로 남는다.
revoke all on function public.claim_openchat_requirement_auto_retry(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_openchat_requirement_auto_retry(uuid,text) to service_role;

-- 줄 세우기. 실패한 공고 중 **자동 재시도를 아직 안 쓴 것**을 뒤에 붙인다.
-- 저장된 r.input_hash 로 따진다. 원문이 바뀐 공고는 맨 앞의 source_checked_at
-- 조건이 이미 줄에 세우므로 여기서 또 따질 것이 없다.
-- 순서는 '요건 있는 것 먼저' 뒤에 '실패 재시도' 를 둔다 — 날마다 도는 판정이
-- 재시도 때문에 밀리면 안 된다.
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
      or(r.status='processing' and r.attempted_at<now()-interval '10 minutes')
      or(r.status='failed' and not exists(select 1 from public.openchat_program_requirement_recoveries v
        where v.program_id=p.id and v.input_hash=r.input_hash and v.kind='auto')))
  order by case when r.status='extracted' then 0 when r.status='failed' then 2 else 1 end,
    p.deadline_at asc nulls last,(r.program_id is null) desc,r.updated_at nulls first,p.created_at desc,p.id
  limit greatest(1,least(coalesce(p_limit,80),100));
$$;

-- 대기 현황의 due 도 같은 조건으로 맞춘다. 두 함수의 조건이 어긋나면 'ready 0'
-- 인데 실제로는 67건이 줄에 서 있는 상태가 되어, 다음에 읽는 사람이 속는다.
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
        or(r.status='processing' and r.attempted_at<now()-interval '10 minutes')
        or(r.status='failed' and not exists(select 1 from public.openchat_program_requirement_recoveries v
          where v.program_id=p.id and v.input_hash=r.input_hash and v.kind='auto'))) as due
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
