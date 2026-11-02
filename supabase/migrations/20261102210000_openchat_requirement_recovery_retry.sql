-- 복구는 '같은 원문에 딱 한 번' 이 아니라 '사람이 부를 때마다, 같은 원문에 세 번까지' 다.
--
-- 2026-11-02, 밀린 공고 145건을 올리면서 요건 추출이 몰아서 실패했다. 대부분은
-- 다시 돌려 살렸지만 3건이 영구히 'failed' 로 남았다. 일반 경로는
-- openchat_program_requirement_attempts 의 (program_id,input_hash) 유일 제약 때문에
-- 같은 원문을 두 번 부르지 않고, 복구 경로도 recoveries 의 같은 유일 제약 때문에
-- 한 번만 부른다. 둘 다 쓰고 나면 원문이 바뀌지 않는 한 되살릴 방법이 없었다.
-- 실패가 공고 탓이 아니라 그때 몰아친 탓이면 사람이 다시 부를 수 있어야 한다.
--
-- 두 가지를 바꾼다.
--   1. **저장된 해시가 지금 읽은 해시와 같아야 한다는 조건을 뺀다.** 복구는 '지금
--      읽은 원문으로 다시 뽑기' 이므로, 실패로 남은 행을 새 해시로 옮긴다
--      (claim_openchat_requirement 이 이미 그렇게 한다).
--   2. **같은 원문에 복구를 세 번까지 허용한다.** 돈이 새는 것을 막던 것이 유일
--      제약이었으니 그 자리를 횟수 상한이 대신한다. 감사 기록은 그대로 한 번에
--      한 행씩 쌓인다.
-- 돌고 있는 추출을 복구가 덮어쓰지 않도록, 일반 경로와 같은 10분 기준도 함께 둔다.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
    where conrelid='public.openchat_program_requirement_recoveries'::regclass and contype='u';
  if constraint_name is not null then
    execute format('alter table public.openchat_program_requirement_recoveries drop constraint %I', constraint_name);
  end if;
end $$;
create index if not exists openchat_program_requirement_recoveries_program_hash_idx
  on public.openchat_program_requirement_recoveries(program_id,input_hash);

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
    where program_id=p_program_id and input_hash=p_input_hash;
  if spent>=3 then return null; end if;
  insert into public.openchat_program_requirement_recoveries(program_id,input_hash)
    values(p_program_id,p_input_hash) returning id into recovery_id;
  delete from public.openchat_program_matches where program_id=p_program_id and review_date>=(now() at time zone 'Asia/Seoul')::date;
  update public.openchat_program_requirements set input_hash=p_input_hash,status='processing',requirements=null,error=null,
    diagnostics='{}'::jsonb,source_manifest='[]'::jsonb,source_complete=false,input_truncated=false,
    attempted_at=now(),extracted_at=null,updated_at=now() where program_id=p_program_id;
  return recovery_id;
end;
$$;
