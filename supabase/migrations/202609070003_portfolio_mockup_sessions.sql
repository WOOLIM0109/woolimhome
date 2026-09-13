-- Explicit administrator requests only. No trigger/cron starts generation or changes a manuscript.
create table if not exists public.portfolio_mockup_sessions (
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.content_work_items(id) on delete cascade,
 candidate_id uuid not null references public.portfolio_candidates(id),
 requested_by text not null,
 binding jsonb not null,
 status text not null default 'queued' check (status in ('queued','preparing','review','uploading','staged','activated','failed','cancelled')),
 worker_id text,
 local_review_url text,
 reopen_requested_at timestamptz,
 source_hash text,
 descriptor jsonb,
 descriptor_hash text,
 manifest jsonb,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists portfolio_mockup_session_open_idx on public.portfolio_mockup_sessions(work_item_id)
 where status in ('queued','preparing','review','uploading','staged');
alter table public.portfolio_mockup_sessions enable row level security;
revoke all on public.portfolio_mockup_sessions from anon,authenticated;
grant select,insert,update on public.portfolio_mockup_sessions to service_role;

create or replace function public.claim_portfolio_mockup_session(p_worker_id text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.portfolio_mockup_sessions%rowtype;
begin
 if p_worker_id is null or p_worker_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'MOCKUP_WORKER_INVALID';end if;
 -- One live session per PC. Failures never auto-requeue; an admin starts a new request explicitly.
 perform pg_advisory_xact_lock(hashtextextended('mockup-session:'||p_worker_id,0));
 if exists(select 1 from public.portfolio_mockup_sessions where worker_id=p_worker_id and status in ('preparing','review','uploading')) then return null;end if;
 select * into job from public.portfolio_mockup_sessions where status='queued' order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.portfolio_mockup_sessions set status='preparing',worker_id=p_worker_id,updated_at=now() where id=job.id returning * into job;
 return to_jsonb(job);
end;$$;
revoke all on function public.claim_portfolio_mockup_session(text) from public,anon,authenticated;
grant execute on function public.claim_portfolio_mockup_session(text) to service_role;

create table if not exists public.portfolio_thumbnail_candidates (
 id uuid primary key,
 work_item_id uuid not null references public.content_work_items(id) on delete cascade,
 requested_by text not null,
 binding jsonb not null,
 proof jsonb not null,
 approval_hash text not null,
 status text not null default 'staged' check(status in('staged','activated')),
 manifest jsonb,
 created_at timestamptz not null default now()
);
alter table public.portfolio_thumbnail_candidates enable row level security;
revoke all on public.portfolio_thumbnail_candidates from anon,authenticated;
grant select,insert,update on public.portfolio_thumbnail_candidates to service_role;

create or replace function public.activate_portfolio_mockup_session(
 p_session_id uuid,p_descriptor_hash text,
 p_work_item_id uuid,p_expected_updated_at timestamptz,p_expected_active_set_id uuid,
 p_expected_metadata jsonb,p_next_metadata jsonb,p_manifest jsonb,p_actor text,p_activated_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.portfolio_mockup_sessions%rowtype;receipt jsonb;
begin
 select * into job from public.portfolio_mockup_sessions where id=p_session_id and work_item_id=p_work_item_id for update;
 if not found or job.status not in('staged','activated') or job.descriptor_hash is distinct from p_descriptor_hash
  or p_manifest->>'setId' is distinct from p_session_id::text
  or p_manifest->>'sourceHash' is distinct from job.source_hash
  or p_manifest#>>'{approval,approvedBy}' is distinct from p_actor then raise exception 'MOCKUP_SESSION_REVIEW_STALE';end if;
 if job.status='activated' then
  if job.manifest is distinct from p_manifest then raise exception 'MOCKUP_SESSION_REVIEW_STALE';end if;
 else
  if (job.binding->>'expectedUpdatedAt')::timestamptz is distinct from p_expected_updated_at then raise exception 'MOCKUP_SESSION_REVIEW_STALE';end if;
 end if;
 perform set_config('woolim.verified_image_write','on',true);
 receipt:=public.activate_portfolio_image_set(p_work_item_id,p_expected_updated_at,p_expected_active_set_id,p_expected_metadata,p_next_metadata,p_manifest,'activate',p_actor,p_activated_at);
 update public.portfolio_mockup_sessions set status='activated',manifest=p_manifest,local_review_url=null,updated_at=now() where id=p_session_id;
 return receipt;
end;$$;
revoke all on function public.activate_portfolio_mockup_session(uuid,text,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.activate_portfolio_mockup_session(uuid,text,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,timestamptz) to service_role;

create or replace function public.activate_portfolio_thumbnail_candidate(
 p_candidate_id uuid,p_approval_hash text,p_work_item_id uuid,p_expected_updated_at timestamptz,
 p_expected_active_version_id uuid,p_expected_active_set_id uuid,p_expected_metadata jsonb,p_next_metadata jsonb,p_manifest jsonb,
 p_next_thumbnail jsonb,p_baseline_id uuid,p_base_fingerprint text,p_actor text,p_activated_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate public.portfolio_thumbnail_candidates%rowtype;receipt jsonb;
begin
 select * into candidate from public.portfolio_thumbnail_candidates where id=p_candidate_id and work_item_id=p_work_item_id for update;
 if not found or candidate.requested_by is distinct from p_actor or candidate.approval_hash is distinct from p_approval_hash
  or candidate.proof->'render' is distinct from p_manifest->'render'
  or candidate.proof->>'sha256' is distinct from p_manifest#>>'{asset,sha256}'
  or p_manifest->>'versionId' is distinct from p_candidate_id::text then raise exception 'THUMBNAIL_REVIEW_STALE';end if;
 if candidate.status='activated' then
  if candidate.manifest is distinct from p_manifest then raise exception 'THUMBNAIL_REVIEW_STALE';end if;
 else
  if (candidate.binding->>'expectedUpdatedAt')::timestamptz is distinct from p_expected_updated_at
   or candidate.binding->>'expectedActiveSetId' is distinct from p_expected_active_set_id::text
   or candidate.binding->>'expectedActiveVersionId' is distinct from p_expected_active_version_id::text then raise exception 'THUMBNAIL_REVIEW_STALE';end if;
 end if;
 perform set_config('woolim.verified_image_write','on',true);
 receipt:=public.activate_portfolio_thumbnail_version(p_work_item_id,p_expected_updated_at,p_expected_active_version_id,p_expected_active_set_id,p_expected_metadata,p_next_metadata,p_manifest,p_next_thumbnail,p_baseline_id,p_base_fingerprint,'activate',p_actor,p_activated_at);
 update public.portfolio_thumbnail_candidates set status='activated',manifest=p_manifest where id=p_candidate_id;
 return receipt;
end;$$;
revoke all on function public.activate_portfolio_thumbnail_candidate(uuid,text,uuid,timestamptz,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.activate_portfolio_thumbnail_candidate(uuid,text,uuid,timestamptz,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,text,text,timestamptz) to service_role;

create or replace function public.guard_verified_portfolio_images() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare protected boolean;
begin
 if current_setting('woolim.verified_image_write',true)='on' then
  if TG_OP='DELETE' then return old;else return new;end if;
 end if;
 if TG_TABLE_NAME='content_work_items' then
  protected:=(old.metadata ? 'portfolioImageSet') or (old.metadata ? 'portfolioThumbnailVersion');
  if protected and ((new.metadata->'portfolioAssets') is distinct from(old.metadata->'portfolioAssets')
   or (new.metadata->'portfolioImageSet') is distinct from(old.metadata->'portfolioImageSet')
   or (new.metadata->'portfolioThumbnailVersion') is distinct from(old.metadata->'portfolioThumbnailVersion')
   or (new.metadata->'portfolioMockup') is distinct from(old.metadata->'portfolioMockup')
   or (old.metadata ? 'generated' and not(new.metadata ? 'generated'))) then raise exception 'MOCKUP_VERIFIED_IMAGES_PROTECTED';end if;
  return new;
 end if;
 select (metadata ? 'portfolioImageSet') or (metadata ? 'portfolioThumbnailVersion') into protected
  from public.content_work_items where id=case when TG_OP='DELETE' then old.work_item_id else new.work_item_id end;
 if protected then raise exception 'MOCKUP_VERIFIED_IMAGES_PROTECTED';end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end;$$;
create or replace trigger protect_verified_portfolio_work before update on public.content_work_items for each row execute function public.guard_verified_portfolio_images();
create or replace trigger protect_verified_portfolio_assets before insert or update or delete on public.content_review_assets for each row execute function public.guard_verified_portfolio_images();
