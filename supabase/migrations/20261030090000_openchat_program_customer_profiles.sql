-- 고객사 요건을 적어 두는 자리.
--
-- 왜 필요한가: 고객 원본은 울림웍스이지만, 울림웍스에는 업종·직원수·매출·인증
-- 칸이 없다. 그래서 지금은 판정에 쓰는 축 7개 중 5개가 처음부터 비어 있고
-- 모든 고객사가 '확인 필요' 로 나온다.
--
-- 고객 DB 를 두 개로 만드는 것이 아니다. 이름·연락처·프로젝트는 그대로
-- 울림웍스에서 읽고, **지원사업 판정에만 필요한 칸을 덧붙인다.**
--
-- 판정 단위는 **사업자**다. 고객사 하나에 사업자가 여럿일 수 있어서
-- (실측 9곳에 16개) 행도 사업자마다 하나씩 둔다.
--
-- 값의 모양은 자사 프로필과 **같은 검사 함수**를 쓴다
-- (`valid_openchat_self_profile_patch`). 두 쪽이 따로 놀면 매칭이 조용히 틀린다.

create table public.openchat_program_customer_profiles (
  id uuid primary key default gen_random_uuid(),
  -- 울림웍스 고객 id. 원본은 거기이고 이 표는 덧붙이는 자리다.
  customer_id text not null check(length(customer_id) between 1 and 160),
  -- 한 고객사 안에서 사업자를 가리키는 이름. 사람이 읽고 고르는 값이다.
  entity_key text not null check(length(entity_key) between 1 and 80),
  entity_name text not null check(length(entity_name) between 1 and 200),
  -- 사업자등록번호. 사람이 같은 사업자인지 확인하는 용도이고 판정에는 쓰지 않는다.
  business_number text check(business_number ~ '^\d{3}-\d{2}-\d{5}$'),
  profile jsonb not null default '{}' check(public.valid_openchat_self_profile_patch(profile)),
  -- 매칭에서 뺄 사업자. 지우지 않고 끄기만 한다 — 되돌릴 수 있어야 한다.
  active boolean not null default true,
  version integer not null default 1 check(version>0),
  updated_by text check(length(updated_by) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, entity_key)
);
create index openchat_program_customer_profiles_customer_idx
  on public.openchat_program_customer_profiles(customer_id);

alter table public.openchat_program_customer_profiles enable row level security;
-- 지우지 않는다. 뺄 사업자는 active=false 로 끈다.
revoke all on public.openchat_program_customer_profiles from public,anon,authenticated,service_role;
grant select,insert,update on public.openchat_program_customer_profiles to service_role;

-- 값이 바뀔 때만 판을 올린다. 같은 값을 다시 저장해도 판은 그대로다.
create function public.stamp_openchat_customer_profile_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.entity_name,new.business_number,new.profile,new.active)
     is distinct from (old.entity_name,old.business_number,old.profile,old.active) then
    new.version:=old.version+1; new.updated_at:=now();
  else new.version:=old.version;
  end if;
  return new;
end;
$$;
create trigger stamp_openchat_customer_profile_version
  before update on public.openchat_program_customer_profiles
  for each row execute function public.stamp_openchat_customer_profile_version();

-- 고객사 요건이 바뀌면 이미 내린 판정은 낡은 것이 된다.
-- 자사 프로필과 똑같이 매칭 판(revision)을 올려 다시 매기게 한다.
-- 값이 그대로면(판이 그대로면) 올리지 않는다 — 헛되이 다시 매기지 않는다.
create function public.bump_openchat_customer_profile_context()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.openchat_program_match_context set revision=revision+1 where id='current';
  return null;
end;
$$;
create trigger bump_openchat_customer_profile_insert_context
  after insert on public.openchat_program_customer_profiles
  for each row execute function public.bump_openchat_customer_profile_context();
create trigger bump_openchat_customer_profile_update_context
  after update on public.openchat_program_customer_profiles
  for each row when (new.version is distinct from old.version)
  execute function public.bump_openchat_customer_profile_context();

revoke all on function public.stamp_openchat_customer_profile_version(),
  public.bump_openchat_customer_profile_context() from public,anon,authenticated;
grant execute on function public.stamp_openchat_customer_profile_version(),
  public.bump_openchat_customer_profile_context() to service_role;
