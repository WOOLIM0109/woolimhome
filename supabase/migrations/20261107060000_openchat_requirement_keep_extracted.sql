-- 이미 뽑아 둔 요건을 지우지 않는다. 2026-11-07.
--
-- 2026-11-05 저녁 17:55~17:57(KST) 사이에 살아 있는 공고 67건의 요건이
-- 한꺼번에 비워졌다. 67건 전부 성공해서 저장까지 끝난 것이었다 —
-- diagnostics 가 stage='stored' 이고 extracted_at 이 찍혀 있었다. 모델이 준
-- 답도 그대로 남아 있었다 (완전한 JSON, 평균 5,900자. 16k 한도와 무관하다).
--
-- 지운 것은 claim_openchat_requirement 의 '이미 처리한 이력' 가지다.
--
--   if claimed = 0 then
--     update ... set status='failed', requirements=null,
--       error='이 원문은 이미 처리한 이력이 있어 재호출하지 않음' ...
--
-- 이 가지는 "같은 원문을 두 번 부르지 않는다" 를 지키려고 둔 것이다. 그 뜻은
-- 맞다. 그런데 **부르지 않겠다는 표시를, 이미 성공해 둔 행을 망가뜨려서**
-- 했다. 돈을 들여 뽑아 둔 요건이 그 자리에서 날아갔고, 아침 목록에서 67건이
-- 판정을 못 받게 되었다.
--
-- 두 가지를 고친다.
--
-- 1. **성공해 둔 요건이 있으면 건드리지 않고 그냥 거절한다.**
--    부르지 않겠다는 결론은 같다. 남아 있는 것을 지울 이유가 없다.
--
-- 2. **거절할 때 판정 기록을 지우지 않는다.**
--    match 삭제가 attempts 넣기보다 앞에 있어서, 거절로 끝나는 호출도 그날의
--    판정을 지웠다. 다시 뽑지도 않으니 그 공고는 판정 없이 남는다. 원문을
--    다시 읽어 실제로 뽑기로 한 뒤에 지우도록 자리를 옮긴다.
--
-- 비워진 67건은 저장해 둔 답으로 되살린다 (requirements-runner 의
-- restorableRequirements). 유료 호출이 없다.

create or replace function public.claim_openchat_requirement(p_program_id uuid,p_input_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:' || p_program_id::text, 0));
  if exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and status='processing' and attempted_at > now()-interval '10 minutes') then return false; end if;
  if exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and input_hash=p_input_hash and status='extracted') then return false; end if;
  insert into public.openchat_program_requirement_attempts (program_id, input_hash)
  values (p_program_id, p_input_hash) on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 0 then
    -- ★ 뽑아 둔 요건이 남아 있으면 손대지 않는다. 부르지 않겠다는 결론만 돌려준다.
    --   (원문 해시가 달라 위 가드를 못 지나친 경우가 2026-11-05 의 그 상황이다.)
    if exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
        and status='extracted' and requirements is not null) then return false; end if;
    update public.openchat_program_requirements set input_hash=p_input_hash,status='failed',requirements=null,
      error='이 원문은 이미 처리한 이력이 있어 재호출하지 않음',updated_at=now() where program_id=p_program_id;
    return false;
  end if;
  -- 실제로 다시 뽑기로 한 뒤에 그날의 판정을 지운다. 거절로 끝나는 호출이
  -- 판정만 지워 버리면, 그 공고는 다시 뽑히지도 않은 채 판정이 없어진다.
  delete from public.openchat_program_matches where program_id=p_program_id
    and review_date >= (now() at time zone 'Asia/Seoul')::date;
  insert into public.openchat_program_requirements(program_id, input_hash, status)
    values (p_program_id, p_input_hash, 'processing')
    on conflict (program_id) do update set input_hash = excluded.input_hash,
      status = 'processing', requirements = null, source_manifest = '[]'::jsonb,
      source_complete = false, input_truncated = false,
      error = null, attempted_at = now(), extracted_at = null, updated_at = now();
  return true;
end;
$$;
