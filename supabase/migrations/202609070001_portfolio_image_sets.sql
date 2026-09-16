-- PREPARED ONLY. Do not apply or enable the import route without explicit
-- production authorization and the matching authenticated package verifier.
-- Immutable manifests + an atomic metadata/review-assets switch. Stored files
-- are uploaded and verified BEFORE this RPC, and are never removed here.
create table if not exists public.portfolio_image_sets (
  id uuid primary key,
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  check (manifest ->> 'setId' = id::text),
  check (manifest ->> 'workItemId' = work_item_id::text)
);
create index if not exists portfolio_image_sets_work_item_idx
  on public.portfolio_image_sets(work_item_id, created_at);

create table if not exists public.portfolio_image_set_activations (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  set_id uuid not null references public.portfolio_image_sets(id),
  previous_set_id uuid,
  operation text not null check (operation in ('activate','restore')),
  actor text not null,
  -- First activation also preserves the pre-migration legacy image snapshot.
  -- No rollback may restore this whole manuscript; restoration rebases image
  -- sources onto the current text through the application service.
  previous_metadata jsonb not null,
  previous_review_assets jsonb not null,
  created_at timestamptz not null
);
alter table public.content_review_assets add column if not exists image_set_id uuid
  references public.portfolio_image_sets(id);
alter table public.portfolio_image_sets enable row level security;
alter table public.portfolio_image_set_activations enable row level security;
revoke all on public.portfolio_image_sets from anon, authenticated;
revoke all on public.portfolio_image_set_activations from anon, authenticated;
revoke insert, update, delete on public.portfolio_image_sets from service_role;
revoke insert, update, delete on public.portfolio_image_set_activations from service_role;
grant select on public.portfolio_image_sets, public.portfolio_image_set_activations to service_role;

create or replace function public.activate_portfolio_image_set(
  p_work_item_id uuid, p_expected_updated_at timestamptz, p_expected_active_set_id uuid,
  p_expected_metadata jsonb, p_next_metadata jsonb, p_manifest jsonb,
  p_operation text, p_actor text, p_activated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  item public.content_work_items%rowtype;
  set_id uuid;
  old_set_id uuid;
  existing_manifest jsonb;
  old_review_assets jsonb;
  mutable_keys text[] := array['generated','portfolioAssets','portfolioImageSet','portfolioThumbnailVersion','portfolioMockup','manualMockupOverride','styleRevision'];
  asset jsonb;
  ordinal bigint;
  next_timestamp timestamptz;
begin
  if p_operation not in ('activate','restore') or p_actor is null or length(trim(p_actor)) = 0
    or length(p_actor) > 100 or p_activated_at is null then
    raise exception 'IMAGE_SET_INVALID_COMMIT';
  end if;
  select * into item from public.content_work_items where id = p_work_item_id for update;
  if not found or item.format <> 'portfolio' then raise exception 'IMAGE_SET_WORK_ITEM_NOT_FOUND'; end if;
  old_set_id := nullif(item.metadata #>> '{portfolioImageSet,activeSetId}', '')::uuid;
  set_id := (p_manifest ->> 'setId')::uuid;
  select manifest into existing_manifest from public.portfolio_image_sets where id = set_id and work_item_id = p_work_item_id;
  if old_set_id = set_id and existing_manifest = p_manifest then
    return jsonb_build_object('workItemId',p_work_item_id,'activeSetId',set_id,'updatedAt',item.updated_at);
  end if;
  if item.updated_at is distinct from p_expected_updated_at
    or item.metadata is distinct from p_expected_metadata
    or old_set_id is distinct from p_expected_active_set_id then
    raise exception 'IMAGE_SET_REVISION_CONFLICT';
  end if;
  if p_manifest ->> 'workItemId' is distinct from p_work_item_id::text
    or p_manifest ->> 'version' is distinct from '1'
    or jsonb_typeof(p_manifest -> 'assets') is distinct from 'array'
    or jsonb_array_length(p_manifest -> 'assets') <> 5
    or coalesce(p_manifest #>> '{approval,manifestHash}', '') !~ '^[a-f0-9]{64}$'
    or p_manifest #>> '{approval,outputInspected}' is distinct from 'true'
    or coalesce(length(trim(p_manifest #>> '{approval,approvedBy}')),0) = 0 then
    raise exception 'IMAGE_SET_INVALID_MANIFEST';
  end if;
  -- The service validates exact template/geometry/receipt/hash and replaces
  -- only existing img src values. This service-role-only RPC additionally
  -- prevents every other manuscript/FAQ/title/metadata field being overwritten.
  if (p_next_metadata - mutable_keys) is distinct from (item.metadata - mutable_keys)
    or p_next_metadata ? 'portfolioThumbnailVersion'
    or ((p_next_metadata -> 'generated') - 'bodyHtml') is distinct from ((item.metadata -> 'generated') - 'bodyHtml')
    or ((p_next_metadata -> 'styleRevision') - 'fingerprint') is distinct from ((item.metadata -> 'styleRevision') - 'fingerprint')
    or p_next_metadata -> 'portfolioAssets' is distinct from p_manifest -> 'assets'
    or p_next_metadata #>> '{portfolioImageSet,activeSetId}' is distinct from set_id::text
    or p_next_metadata #>> '{portfolioImageSet,manifestHash}' is distinct from p_manifest #>> '{approval,manifestHash}'
    or jsonb_typeof(p_next_metadata #> '{generated,bodyHtml}') is distinct from 'string' then
    raise exception 'IMAGE_SET_PROTECTED_FIELDS_CHANGED';
  end if;
  for asset, ordinal in select value, ordinality from jsonb_array_elements(p_manifest -> 'assets') with ordinality loop
    if asset ->> 'kind' is distinct from (case when ordinal = 1 then 'thumbnail' else 'body_image' end)
      or asset ->> 'bucket' is distinct from 'portfolio-rendered'
      or asset ->> 'path' is distinct from ('verified-local/' || p_work_item_id::text || '/' || set_id::text || '/' || (ordinal - 1)::text || '.png')
      or asset ->> 'url' is distinct from ('/api/admin/assets?bucket=portfolio-rendered&path=verified-local%2F' || p_work_item_id::text || '%2F' || set_id::text || '%2F' || (ordinal - 1)::text || '.png')
      or coalesce(asset ->> 'sha256', '') !~ '^[a-f0-9]{64}$'
      or (asset ->> 'width')::integer is distinct from (case when ordinal = 1 then 1080 else 1600 end)
      or (asset ->> 'height')::integer is distinct from (case when ordinal = 1 then 1080 else 900 end) then
      raise exception 'IMAGE_SET_INVALID_ASSET';
    end if;
  end loop;
  select manifest into existing_manifest from public.portfolio_image_sets where id = set_id;
  if found and existing_manifest is distinct from p_manifest then raise exception 'IMAGE_SET_ID_REUSED'; end if;
  if p_operation = 'restore' and existing_manifest is null then raise exception 'IMAGE_SET_RESTORE_NOT_FOUND'; end if;
  insert into public.portfolio_image_sets(id,work_item_id,manifest)
    values(set_id,p_work_item_id,p_manifest) on conflict(id) do nothing;
  -- Re-check after a possible concurrent insert of the same immutable ID.
  if (select manifest from public.portfolio_image_sets where id=set_id) is distinct from p_manifest then
    raise exception 'IMAGE_SET_ID_REUSED';
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order,a.created_at),'[]'::jsonb)
    into old_review_assets from public.content_review_assets a where a.work_item_id=p_work_item_id;
  insert into public.portfolio_image_set_activations(work_item_id,set_id,previous_set_id,operation,actor,previous_metadata,previous_review_assets,created_at)
    values(p_work_item_id,set_id,old_set_id,p_operation,p_actor,item.metadata,old_review_assets,p_activated_at);
  perform set_config('woolim.verified_image_write','on',true);
  delete from public.content_review_assets where work_item_id=p_work_item_id and asset_type in ('thumbnail','body_image');
  insert into public.content_review_assets(work_item_id,asset_type,public_url,sort_order,approved,review_note,image_set_id)
    select p_work_item_id,value ->> 'kind',value ->> 'url',(ordinality-1)::integer,true,
      value ->> 'caption',set_id from jsonb_array_elements(p_manifest -> 'assets') with ordinality;
  -- No status, title, summary, schedule, URL, publication or job queue updates.
  next_timestamp := greatest(p_activated_at, item.updated_at + interval '1 microsecond');
  update public.content_work_items set metadata=p_next_metadata, updated_at=next_timestamp where id=p_work_item_id;
  return jsonb_build_object('workItemId',p_work_item_id,'activeSetId',set_id,'updatedAt',next_timestamp);
end;
$$;
revoke all on function public.activate_portfolio_image_set(uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.activate_portfolio_image_set(uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,text,timestamptz) to service_role;
