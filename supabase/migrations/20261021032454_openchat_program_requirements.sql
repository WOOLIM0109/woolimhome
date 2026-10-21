-- Separate private review data; no existing program or publication writes.
create table public.openchat_program_requirements (
  program_id uuid primary key references public.openchat_programs(id) on delete cascade,
  input_hash text not null,
  status text not null check (status in ('processing', 'extracted', 'failed')),
  requirements jsonb,
  source_manifest jsonb not null default '[]'::jsonb,
  source_complete boolean not null default false,
  input_truncated boolean not null default false,
  model text,
  error text,
  attempted_at timestamptz not null default now(),
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Immutable attempts prevent another paid call even after a failed/stopped run.
create table public.openchat_program_requirement_attempts (
  program_id uuid not null references public.openchat_programs(id) on delete cascade,
  input_hash text not null,
  attempted_at timestamptz not null default now(),
  primary key (program_id, input_hash)
);
create table public.openchat_program_matches (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.openchat_programs(id) on delete cascade,
  target_kind text not null check (target_kind in ('self', 'customer')),
  target_id text not null,
  target_name text not null,
  verdict text not null check (verdict in ('candidate', 'mismatch', 'unknown')),
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array'),
  score numeric not null default 0 check (score >= 0),
  review_date date not null,
  selected_for_reading boolean not null default false,
  created_at timestamptz not null default now(),
  unique (program_id, target_kind, target_id, review_date)
);
create index openchat_program_matches_reading_idx
  on public.openchat_program_matches(review_date, score desc) where selected_for_reading;
create table public.openchat_match_profiles_cache (
  cache_date date primary key,
  payload jsonb not null default '[]'::jsonb check (jsonb_typeof(payload) = 'array'),
  field_names jsonb not null default '{}'::jsonb check (jsonb_typeof(field_names) = 'object'),
  fetched_at timestamptz,
  expires_at timestamptz,
  refresh_owner uuid,
  refresh_expires_at timestamptz,
  refresh_state jsonb
);

alter table public.openchat_program_requirements enable row level security;
alter table public.openchat_program_requirement_attempts enable row level security;
alter table public.openchat_program_matches enable row level security;
alter table public.openchat_match_profiles_cache enable row level security;
revoke all on public.openchat_program_requirements, public.openchat_program_requirement_attempts,
  public.openchat_program_matches, public.openchat_match_profiles_cache from public, anon, authenticated;
grant all on public.openchat_program_requirements, public.openchat_program_requirement_attempts,
  public.openchat_program_matches, public.openchat_match_profiles_cache to service_role;

create function public.claim_openchat_requirement(p_program_id uuid, p_input_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:' || p_program_id::text, 0));
  if exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and status='processing' and attempted_at > now()-interval '10 minutes') then return false; end if;
  if exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and input_hash=p_input_hash and status='extracted') then return false; end if;
  delete from public.openchat_program_matches where program_id=p_program_id
    and review_date >= (now() at time zone 'Asia/Seoul')::date;
  insert into public.openchat_program_requirement_attempts (program_id, input_hash)
  values (p_program_id, p_input_hash) on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 0 then
    update public.openchat_program_requirements set input_hash=p_input_hash,status='failed',requirements=null,
      error='이 원문은 이미 처리한 이력이 있어 재호출하지 않음',updated_at=now() where program_id=p_program_id;
    return false;
  end if;
  insert into public.openchat_program_requirements(program_id, input_hash, status)
    values (p_program_id, p_input_hash, 'processing')
    on conflict (program_id) do update set input_hash = excluded.input_hash,
      status = 'processing', requirements = null, source_manifest = '[]'::jsonb,
      source_complete = false, input_truncated = false,
      error = null, attempted_at = now(), extracted_at = null, updated_at = now();
  return true;
end;
$$;
-- Used only when the budget gate refused before any Gemini work began.
create function public.release_openchat_requirement_budget(p_program_id uuid, p_input_hash text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.openchat_program_requirements
    where program_id = p_program_id and input_hash = p_input_hash and status = 'processing';
  delete from public.openchat_program_requirement_attempts
    where program_id = p_program_id and input_hash = p_input_hash;
end;
$$;
create function public.claim_openchat_match_profiles_refresh(p_cache_date date, p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  insert into public.openchat_match_profiles_cache(cache_date, refresh_owner, refresh_expires_at)
    values(p_cache_date, p_owner, now() + interval '10 minutes')
    on conflict (cache_date) do update set refresh_owner = p_owner,
      refresh_expires_at = now() + interval '10 minutes'
    where (openchat_match_profiles_cache.fetched_at is null
        or openchat_match_profiles_cache.expires_at <= now())
      and (openchat_match_profiles_cache.refresh_expires_at is null
        or openchat_match_profiles_cache.refresh_expires_at <= now());
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;
create function public.finish_openchat_match_profiles_refresh(p_cache_date date, p_owner uuid,
  p_payload jsonb, p_field_names jsonb, p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare finished integer;
begin
  update public.openchat_match_profiles_cache set payload = p_payload,
    field_names = p_field_names, fetched_at = now(), expires_at = p_expires_at,
    refresh_owner = null, refresh_expires_at = null, refresh_state = null
    where cache_date = p_cache_date and refresh_owner = p_owner and refresh_expires_at > now();
  get diagnostics finished = row_count;
  return finished = 1;
end;
$$;
create function public.release_openchat_match_profiles_refresh(p_cache_date date, p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare released integer;
begin
  update public.openchat_match_profiles_cache set refresh_owner = null, refresh_expires_at = null
    where cache_date = p_cache_date and refresh_owner = p_owner;
  get diagnostics released = row_count;
  return released = 1;
end;
$$;
create function public.checkpoint_openchat_match_profiles_refresh(p_cache_date date, p_owner uuid, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare saved integer;
begin
  update public.openchat_match_profiles_cache set refresh_state = p_state,
    refresh_owner = null, refresh_expires_at = null
    where cache_date = p_cache_date and refresh_owner = p_owner and refresh_expires_at > now();
  get diagnostics saved = row_count;
  return saved = 1;
end;
$$;
-- Serialize the daily selection so overlapping runs cannot select >8 programs.
create function public.save_openchat_program_matches(p_program_id uuid, p_review_date date, p_input_hash text, p_matches jsonb)
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
  update public.openchat_program_matches set selected_for_reading=false where review_date=p_review_date;
  update public.openchat_program_matches m set selected_for_reading=true
    where m.review_date=p_review_date and m.verdict <> 'mismatch' and m.program_id in
      (select x.program_id from public.openchat_program_matches x
       join public.openchat_programs p on p.id=x.program_id
       where x.review_date=p_review_date and x.verdict <> 'mismatch' and p.status <> 'excluded'
       and (p.deadline_at is null or p.deadline_at >= now())
       group by x.program_id order by max(x.score) desc,x.program_id limit 8);
end;
$$;
-- Completed prefixes cannot starve older work. Source changes and a new day
-- rematch without charging Gemini for the same input hash.
create function public.list_openchat_requirement_work(p_review_date date, p_limit integer default 20,
  p_program_ids uuid[] default null)
returns table(id uuid, deadline_at timestamptz, created_at timestamptz)
language sql security invoker set search_path = '' as $$
  select p.id,p.deadline_at,p.created_at from public.openchat_programs p
  left join public.openchat_program_requirements r on r.program_id=p.id
  left join public.openchat_program_attachment_discovery d on d.program_id=p.id
  join lateral (select max(greatest(a.created_at,a.extracted_at,a.processing_started_at)) as touched,
    count(*) filter (where a.text_status='extracted' and length(a.text_content)>0) as extracted
    from public.openchat_program_attachments a where a.program_id=p.id) a on a.extracted>0
  where p.status <> 'excluded' and (p.deadline_at is null or p.deadline_at>=now())
    and p.created_at>=now()-interval '60 days'
    and (p_program_ids is null or p.id=any(p_program_ids))
    and (r.program_id is null or r.updated_at<greatest(d.checked_at,a.touched)
      or (r.status='extracted' and not exists (select 1 from public.openchat_program_matches m
        where m.program_id=p.id and m.review_date=p_review_date))
      or (r.status='processing' and r.attempted_at<now()-interval '10 minutes'))
  order by (r.program_id is null) desc,r.updated_at nulls first,p.created_at desc,p.id
  limit greatest(1,least(coalesce(p_limit,20),80));
$$;
revoke all on function public.claim_openchat_requirement(uuid,text),
  public.release_openchat_requirement_budget(uuid,text),
  public.claim_openchat_match_profiles_refresh(date,uuid),
  public.finish_openchat_match_profiles_refresh(date,uuid,jsonb,jsonb,timestamptz),
  public.release_openchat_match_profiles_refresh(date,uuid),
  public.checkpoint_openchat_match_profiles_refresh(date,uuid,jsonb),
  public.save_openchat_program_matches(uuid,date,text,jsonb),
  public.list_openchat_requirement_work(date,integer,uuid[]) from public, anon, authenticated;
grant execute on function public.claim_openchat_requirement(uuid,text),
  public.release_openchat_requirement_budget(uuid,text),
  public.claim_openchat_match_profiles_refresh(date,uuid),
  public.finish_openchat_match_profiles_refresh(date,uuid,jsonb,jsonb,timestamptz),
  public.release_openchat_match_profiles_refresh(date,uuid),
  public.checkpoint_openchat_match_profiles_refresh(date,uuid,jsonb),
  public.save_openchat_program_matches(uuid,date,text,jsonb),
  public.list_openchat_requirement_work(date,integer,uuid[]) to service_role;
