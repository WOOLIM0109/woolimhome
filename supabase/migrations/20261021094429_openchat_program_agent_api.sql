-- Private AI review interfaces. No collection/publication rows or schedules change.
create table public.openchat_program_match_context (
  id text primary key check(id='current'), revision bigint not null default 1 check(revision>0)
);
insert into public.openchat_program_match_context(id) values('current');

create function public.valid_openchat_self_profile_patch(p_patch jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare item record; kind text;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then return false; end if;
  for item in select key,value from pg_catalog.jsonb_each(p_patch) loop
    kind:=jsonb_typeof(item.value);
    if item.key not in ('region','founded_on','business_type','industries','employees','revenue_krw','revenue_band',
      'certifications','certifications_complete','has_support_history','notes') then return false; end if;
    if item.key in ('certifications_complete','has_support_history') then
      if kind<>'boolean' then return false; end if;
    elsif kind='null' then continue;
    elsif item.key in ('industries','certifications') then
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

create table public.openchat_program_self_profiles (
  id text primary key check(id in ('woolim-company','cellavento')),
  name text not null check(length(name) between 1 and 200), aliases text[] not null default '{}',
  profile jsonb not null check(public.valid_openchat_self_profile_patch(profile)),
  version integer not null default 1 check(version>0), updated_at timestamptz not null default now()
);
insert into public.openchat_program_self_profiles(id,name,aliases,profile) values
  ('woolim-company','울림컴퍼니','{}',
   '{"region":null,"founded_on":null,"business_type":null,"industries":null,"employees":null,"revenue_krw":null,"revenue_band":null,"certifications":null,"certifications_complete":false,"has_support_history":false,"notes":null}'),
  ('cellavento','셀라벤토','{로닛}',
   '{"region":null,"founded_on":null,"business_type":null,"industries":null,"employees":null,"revenue_krw":null,"revenue_band":null,"certifications":null,"certifications_complete":false,"has_support_history":false,"notes":null}');

create table public.openchat_program_reviews (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.openchat_programs(id) on delete cascade,
  target_kind text not null check(target_kind in ('self','customer')), target_id text not null check(length(target_id) between 1 and 160),
  target_name text not null check(length(target_name) between 1 and 200),
  conclusion text not null check(conclusion in ('추천','검토','제외','확인 필요')),
  review_markdown text not null check(length(review_markdown) between 1 and 50000),
  missing_documents jsonb not null default '[]' check(jsonb_typeof(missing_documents)='array'),
  next_actions jsonb not null default '[]' check(jsonb_typeof(next_actions)='array'),
  reviewer text not null default 'ai:gongo-matcher' check(reviewer='ai:gongo-matcher'),
  created_at timestamptz not null default now()
);
create index openchat_program_reviews_latest_idx
  on public.openchat_program_reviews(program_id,target_kind,target_id,created_at desc,id desc);

create table public.openchat_program_profile_proposals (
  id uuid primary key default gen_random_uuid(), profile_id text not null references public.openchat_program_self_profiles(id),
  base_version integer not null check(base_version>0), patch jsonb not null check(public.valid_openchat_self_profile_patch(patch)
    and patch<>'{}'::jsonb and octet_length(patch::text)<=32768),
  reason text not null check(length(reason) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  submitted_by text not null default 'ai:gongo-matcher', reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check((status='pending' and reviewed_at is null and reviewed_by is null)
    or(status<>'pending' and reviewed_at is not null and reviewed_by is not null))
);
create index openchat_program_profile_proposals_pending_idx on public.openchat_program_profile_proposals(status,created_at);

alter table public.openchat_program_match_context enable row level security;
alter table public.openchat_program_self_profiles enable row level security;
alter table public.openchat_program_reviews enable row level security;
alter table public.openchat_program_profile_proposals enable row level security;
revoke all on public.openchat_program_match_context,public.openchat_program_self_profiles,
  public.openchat_program_reviews,public.openchat_program_profile_proposals from public,anon,authenticated,service_role;
grant select,insert,update on public.openchat_program_match_context,public.openchat_program_self_profiles,
  public.openchat_program_profile_proposals to service_role;
-- Review rows are append-only even for the API's service role.
grant select,insert on public.openchat_program_reviews to service_role;

create function public.stamp_openchat_self_profile_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.name,new.aliases,new.profile) is distinct from (old.name,old.aliases,old.profile) then
    new.version:=old.version+1; new.updated_at:=now();
  else new.version:=old.version;
  end if;
  return new;
end;
$$;
create trigger stamp_openchat_self_profile_version before update on public.openchat_program_self_profiles
  for each row execute function public.stamp_openchat_self_profile_version();

create function public.bump_openchat_program_match_context()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='openchat_program_self_profiles' then
    if new.version is not distinct from old.version then return new; end if;
  else
    if new.fetched_at is null then return new; end if;
    if tg_op='UPDATE' then
      if old.fetched_at is not null and new.payload is not distinct from old.payload then return new; end if;
    end if;
  end if;
  update public.openchat_program_match_context set revision=revision+1 where id='current';
  return new;
end;
$$;
create trigger bump_openchat_self_profile_context after update on public.openchat_program_self_profiles
  for each row execute function public.bump_openchat_program_match_context();
create trigger bump_openchat_customer_cache_context after insert or update on public.openchat_match_profiles_cache
  for each row execute function public.bump_openchat_program_match_context();

create function public.apply_openchat_program_profile_proposal(p_proposal_id uuid,p_expected_version integer,p_actor text,p_approve boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare proposal public.openchat_program_profile_proposals; current_profile public.openchat_program_self_profiles;
begin
  if p_expected_version is null or p_expected_version<1 or p_actor is null
    or length(p_actor) not between 1 and 200 or p_approve is null then raise exception 'Invalid approval'; end if;
  select * into proposal from public.openchat_program_profile_proposals where id=p_proposal_id;
  if not found then raise exception 'Proposal unavailable'; end if;
  select * into current_profile from public.openchat_program_self_profiles where id=proposal.profile_id for update;
  select * into proposal from public.openchat_program_profile_proposals where id=p_proposal_id for update;
  if proposal.status<>'pending' or proposal.base_version<>p_expected_version
    or(p_approve and current_profile.version<>p_expected_version) then raise exception 'Proposal conflict' using errcode='40001'; end if;
  if p_approve then
    update public.openchat_program_self_profiles set profile=profile||proposal.patch where id=proposal.profile_id;
  end if;
  update public.openchat_program_profile_proposals set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=p_actor,reviewed_at=now() where id=p_proposal_id;
  return jsonb_build_object('id',p_proposal_id,'status',case when p_approve then 'approved' else 'rejected' end);
end;
$$;

alter table public.openchat_program_requirements
  add column matched_profile_revision bigint not null default 0,
  add column matched_rule_version integer not null default 0;
-- Hold the context row through the original atomic match save. An approval/cache
-- publication either precedes this snapshot check or follows and makes it due again.
create function public.save_openchat_program_matches(p_program_id uuid,p_review_date date,p_input_hash text,p_matches jsonb,p_profile_revision bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare current_revision bigint;
begin
  select revision into current_revision from public.openchat_program_match_context where id='current' for share;
  if p_profile_revision is null or current_revision is distinct from p_profile_revision then
    raise exception 'Profile snapshot changed' using errcode='40001';
  end if;
  perform public.save_openchat_program_matches(p_program_id,p_review_date,p_input_hash,p_matches);
  update public.openchat_program_requirements set matched_profile_revision=p_profile_revision,matched_rule_version=2
    where program_id=p_program_id and input_hash=p_input_hash and status='extracted';
end;
$$;

revoke all on function public.valid_openchat_self_profile_patch(jsonb),public.stamp_openchat_self_profile_version(),
  public.bump_openchat_program_match_context(),public.apply_openchat_program_profile_proposal(uuid,integer,text,boolean),
  public.save_openchat_program_matches(uuid,date,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.valid_openchat_self_profile_patch(jsonb),public.stamp_openchat_self_profile_version(),
  public.bump_openchat_program_match_context(),public.apply_openchat_program_profile_proposal(uuid,integer,text,boolean),
  public.save_openchat_program_matches(uuid,date,text,jsonb,bigint) to service_role;

-- Snapshot and rule changes rematch existing canonical input without another paid call.
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
        or r.matched_rule_version<2
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
        or r.matched_rule_version<2
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
