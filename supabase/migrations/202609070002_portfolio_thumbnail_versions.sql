-- PREPARED ONLY: separate thumbnail-only contract. Apply only with explicit
-- authorization, authenticated render/PNG verifier and retention protection.
-- Depends on 202609070001 for content_review_assets.image_set_id.
create table if not exists public.portfolio_thumbnail_versions (
  id uuid primary key,
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  check (manifest ->> 'versionId' = id::text),
  check (manifest ->> 'workItemId' = work_item_id::text)
);
create index if not exists portfolio_thumbnail_versions_item_idx
  on public.portfolio_thumbnail_versions(work_item_id,created_at);
create table if not exists public.portfolio_thumbnail_version_activations (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.content_work_items(id) on delete cascade,
  baseline_id uuid not null references public.portfolio_thumbnail_versions(id),
  version_id uuid references public.portfolio_thumbnail_versions(id),
  previous_version_id uuid references public.portfolio_thumbnail_versions(id),
  base_fingerprint text not null check (base_fingerprint ~ '^[a-f0-9]{64}$'),
  operation text not null check (operation in ('activate','restore','restore_legacy')),
  actor text not null,
  previous_thumbnail jsonb not null,
  previous_review_thumbnail jsonb not null,
  previous_pointer jsonb,
  created_at timestamptz not null
);
create index if not exists portfolio_thumbnail_activations_baseline_idx
  on public.portfolio_thumbnail_version_activations(work_item_id,baseline_id,created_at);
alter table public.content_review_assets add column if not exists thumbnail_version_id uuid
  references public.portfolio_thumbnail_versions(id);
alter table public.portfolio_thumbnail_versions enable row level security;
alter table public.portfolio_thumbnail_version_activations enable row level security;
revoke all on public.portfolio_thumbnail_versions from anon,authenticated;
revoke all on public.portfolio_thumbnail_version_activations from anon,authenticated;
revoke insert,update,delete on public.portfolio_thumbnail_versions from service_role;
revoke insert,update,delete on public.portfolio_thumbnail_version_activations from service_role;
grant select on public.portfolio_thumbnail_versions,public.portfolio_thumbnail_version_activations to service_role;

create or replace function public.activate_portfolio_thumbnail_version(
  p_work_item_id uuid, p_expected_updated_at timestamptz,
  p_expected_active_version_id uuid, p_expected_active_set_id uuid,
  p_expected_metadata jsonb, p_next_metadata jsonb, p_manifest jsonb,
  p_next_thumbnail jsonb, p_baseline_id uuid, p_base_fingerprint text,
  p_operation text, p_actor text, p_activated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public,pg_temp as $$
declare
  item public.content_work_items%rowtype;
  previous_review public.content_review_assets%rowtype;
  previous_thumb jsonb;
  legacy_thumb jsonb;
  legacy_review jsonb;
  existing_manifest jsonb;
  old_version_id uuid;
  old_set_id uuid;
  version_id uuid;
  old_pointer jsonb;
  next_pointer jsonb;
  old_assets jsonb;
  next_assets jsonb;
  i integer;
  new_timestamp timestamptz;
begin
  if p_operation not in ('activate','restore','restore_legacy') or p_baseline_id is null
    or p_base_fingerprint !~ '^[a-f0-9]{64}$' or p_base_fingerprint is null
    or p_actor is null or length(trim(p_actor))=0 or length(p_actor)>100 or p_activated_at is null then
    raise exception 'THUMBNAIL_INVALID_COMMIT';
  end if;
  select * into item from public.content_work_items where id=p_work_item_id for update;
  if not found or item.format <> 'portfolio' then raise exception 'THUMBNAIL_WORK_ITEM_NOT_FOUND'; end if;
  old_pointer := item.metadata -> 'portfolioThumbnailVersion';
  next_pointer := p_next_metadata -> 'portfolioThumbnailVersion';
  old_version_id := nullif(old_pointer ->> 'activeVersionId','')::uuid;
  old_set_id := nullif(item.metadata #>> '{portfolioImageSet,activeSetId}','')::uuid;
  old_assets := item.metadata -> 'portfolioAssets';
  next_assets := p_next_metadata -> 'portfolioAssets';
  if jsonb_typeof(old_assets) is distinct from 'array' or jsonb_typeof(next_assets) is distinct from 'array'
    or jsonb_array_length(old_assets) <> jsonb_array_length(next_assets)
    or (select count(*) from jsonb_array_elements(old_assets) a where a->>'kind'='thumbnail') <> 1
    or (select count(*) from jsonb_array_elements(next_assets) a where a->>'kind'='thumbnail') <> 1 then
    raise exception 'THUMBNAIL_LEGACY_MAPPING_REQUIRED';
  end if;
  select value into previous_thumb from jsonb_array_elements(old_assets) where value->>'kind'='thumbnail';
  if p_operation='restore_legacy' then
    if p_manifest is not null or next_pointer is not null then raise exception 'THUMBNAIL_INVALID_COMMIT'; end if;
    select previous_thumbnail,previous_review_thumbnail into legacy_thumb,legacy_review
      from public.portfolio_thumbnail_version_activations
      where work_item_id=p_work_item_id and baseline_id=p_baseline_id and previous_version_id is null
        and base_fingerprint=p_base_fingerprint order by created_at,id limit 1;
    if not found or legacy_thumb is distinct from p_next_thumbnail then raise exception 'THUMBNAIL_RESTORE_NOT_FOUND'; end if;
    if old_version_id is null and previous_thumb=legacy_thumb and old_set_id is not distinct from p_expected_active_set_id then
      return jsonb_build_object('workItemId',p_work_item_id,'activeVersionId',null,'updatedAt',item.updated_at);
    end if;
  else
    version_id := (p_manifest->>'versionId')::uuid;
    if p_manifest->>'version' is distinct from '1' or p_manifest->>'workItemId' is distinct from p_work_item_id::text
      or p_manifest->>'baselineId' is distinct from p_baseline_id::text
      or p_manifest->>'baseSetId' is distinct from p_expected_active_set_id::text
      or p_manifest->>'baseFingerprint' is distinct from p_base_fingerprint
      or p_manifest->'asset' is distinct from p_next_thumbnail
      or p_manifest #>> '{approval,outputInspected}' is distinct from 'true'
      or coalesce(p_manifest #>> '{approval,manifestHash}','') !~ '^[a-f0-9]{64}$'
      or (p_operation='activate' and p_manifest #>> '{approval,approvedBy}' is distinct from p_actor)
      or p_next_thumbnail->>'path' is distinct from ('verified-thumbnail/'||p_work_item_id::text||'/'||version_id::text||'.png')
      or p_next_thumbnail->>'url' is distinct from ('/api/admin/assets?bucket=portfolio-rendered&path=verified-thumbnail%2F'||p_work_item_id::text||'%2F'||version_id::text||'.png')
      or p_next_thumbnail->>'bucket' is distinct from 'portfolio-rendered'
      or p_next_thumbnail->>'width' is distinct from '1080' or p_next_thumbnail->>'height' is distinct from '1080'
      or coalesce(p_next_thumbnail->>'sha256','') !~ '^[a-f0-9]{64}$'
      or next_pointer->>'version' is distinct from '1' or next_pointer->>'activeVersionId' is distinct from version_id::text
      or next_pointer->>'baselineId' is distinct from p_baseline_id::text
      or next_pointer->>'baseFingerprint' is distinct from p_base_fingerprint
      or next_pointer->>'baseSetId' is distinct from p_expected_active_set_id::text
      or next_pointer->>'manifestHash' is distinct from p_manifest #>> '{approval,manifestHash}'
      or next_pointer->>'activatedBy' is distinct from p_actor then
      raise exception 'THUMBNAIL_INVALID_MANIFEST';
    end if;
    select manifest into existing_manifest from public.portfolio_thumbnail_versions where id=version_id;
    if found and existing_manifest is distinct from p_manifest then raise exception 'THUMBNAIL_VERSION_ID_REUSED'; end if;
    if p_operation='restore' and existing_manifest is null then raise exception 'THUMBNAIL_RESTORE_NOT_FOUND'; end if;
    if old_version_id=version_id and existing_manifest=p_manifest and previous_thumb=p_next_thumbnail
      and old_pointer->>'manifestHash'=p_manifest #>> '{approval,manifestHash}'
      and old_pointer->>'baseFingerprint'=p_base_fingerprint and old_set_id is not distinct from p_expected_active_set_id then
      return jsonb_build_object('workItemId',p_work_item_id,'activeVersionId',version_id,'updatedAt',item.updated_at);
    end if;
  end if;
  -- Same immutable operation above is a no-op, including after later article
  -- edits. Any NEW operation must preserve every non-thumbnail byte/field.
  if (p_next_metadata - array['portfolioAssets','portfolioThumbnailVersion'])
      is distinct from (item.metadata - array['portfolioAssets','portfolioThumbnailVersion']) then
    raise exception 'THUMBNAIL_PROTECTED_FIELDS_CHANGED';
  end if;
  for i in 0..jsonb_array_length(old_assets)-1 loop
    if old_assets->i->>'kind'='thumbnail' then
      if next_assets->i is distinct from p_next_thumbnail or p_next_thumbnail->>'kind' is distinct from 'thumbnail' then
        raise exception 'THUMBNAIL_PROTECTED_FIELDS_CHANGED';
      end if;
    elsif old_assets->i is distinct from next_assets->i then
      raise exception 'THUMBNAIL_PROTECTED_FIELDS_CHANGED';
    end if;
  end loop;
  if item.updated_at is distinct from p_expected_updated_at or item.metadata is distinct from p_expected_metadata
    or old_version_id is distinct from p_expected_active_version_id or old_set_id is distinct from p_expected_active_set_id then
    raise exception 'THUMBNAIL_REVISION_CONFLICT';
  end if;
  if (old_version_id is not null and (old_pointer->>'baselineId' is distinct from p_baseline_id::text
      or old_pointer->>'baseFingerprint' is distinct from p_base_fingerprint))
    or (old_version_id is null and p_operation <> 'activate')
    or (old_version_id is null and p_baseline_id is distinct from version_id) then
    raise exception 'THUMBNAIL_BASE_CHANGED';
  end if;
  if (select count(*) from public.content_review_assets where work_item_id=p_work_item_id and asset_type='thumbnail') <> 1 then
    raise exception 'THUMBNAIL_LEGACY_MAPPING_REQUIRED';
  end if;
  select * into previous_review from public.content_review_assets where work_item_id=p_work_item_id and asset_type='thumbnail' for update;
  if previous_review.public_url is distinct from previous_thumb->>'url' then raise exception 'THUMBNAIL_LEGACY_MAPPING_REQUIRED'; end if;
  if version_id is not null then
    insert into public.portfolio_thumbnail_versions(id,work_item_id,manifest)
      values(version_id,p_work_item_id,p_manifest) on conflict(id) do nothing;
    if (select manifest from public.portfolio_thumbnail_versions where id=version_id) is distinct from p_manifest then
      raise exception 'THUMBNAIL_VERSION_ID_REUSED';
    end if;
  end if;
  insert into public.portfolio_thumbnail_version_activations(work_item_id,baseline_id,version_id,previous_version_id,
    base_fingerprint,operation,actor,previous_thumbnail,previous_review_thumbnail,previous_pointer,created_at)
    values(p_work_item_id,p_baseline_id,version_id,old_version_id,p_base_fingerprint,p_operation,p_actor,
      previous_thumb,to_jsonb(previous_review),old_pointer,p_activated_at);
  -- No BODY row is inserted/deleted/updated. Restore only the original thumbnail
  -- row snapshot, never previous metadata / a previous manuscript.
  perform set_config('woolim.verified_image_write','on',true);
  delete from public.content_review_assets where id=previous_review.id and asset_type='thumbnail';
  if p_operation='restore_legacy' then
    insert into public.content_review_assets(id,work_item_id,asset_type,public_url,sort_order,approved,review_note,created_at,image_set_id,thumbnail_version_id)
      values((legacy_review->>'id')::uuid,p_work_item_id,'thumbnail',legacy_review->>'public_url',
        (legacy_review->>'sort_order')::integer,(legacy_review->>'approved')::boolean,legacy_review->>'review_note',
        (legacy_review->>'created_at')::timestamptz,(legacy_review->>'image_set_id')::uuid,(legacy_review->>'thumbnail_version_id')::uuid);
  else
    insert into public.content_review_assets(work_item_id,asset_type,public_url,sort_order,approved,review_note,image_set_id,thumbnail_version_id)
      values(p_work_item_id,'thumbnail',p_next_thumbnail->>'url',previous_review.sort_order,true,p_next_thumbnail->>'caption',p_expected_active_set_id,version_id);
  end if;
  new_timestamp := greatest(p_activated_at,item.updated_at+interval '1 microsecond');
  update public.content_work_items set metadata=p_next_metadata,updated_at=new_timestamp where id=p_work_item_id;
  return jsonb_build_object('workItemId',p_work_item_id,'activeVersionId',version_id,'updatedAt',new_timestamp);
end;
$$;
revoke all on function public.activate_portfolio_thumbnail_version(uuid,timestamptz,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.activate_portfolio_thumbnail_version(uuid,timestamptz,uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,text,text,text,timestamptz) to service_role;
