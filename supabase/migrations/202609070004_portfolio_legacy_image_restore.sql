create or replace function public.restore_legacy_portfolio_images(
 p_work_item_id uuid,p_history_id uuid,p_expected_updated_at timestamptz,p_expected_metadata jsonb,p_next_metadata jsonb,p_actor text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.content_work_items%rowtype;history public.portfolio_image_set_activations%rowtype;at timestamptz;
 keys text[]:=array['generated','portfolioAssets','portfolioImageSet','portfolioThumbnailVersion','portfolioMockup','manualMockupOverride','styleRevision'];
begin
 if p_actor is null or length(trim(p_actor))=0 or length(p_actor)>100 then raise exception 'IMAGE_SET_ACTOR_REQUIRED';end if;
 select * into item from public.content_work_items where id=p_work_item_id for update;
 if not found or item.format<>'portfolio' then raise exception 'IMAGE_SET_WORK_ITEM_NOT_FOUND';end if;
 select * into history from public.portfolio_image_set_activations where id=p_history_id and work_item_id=p_work_item_id and previous_set_id is null;
 if not found then raise exception 'IMAGE_SET_LEGACY_RESTORE_INVALID';end if;
 if item.updated_at is distinct from p_expected_updated_at or item.metadata is distinct from p_expected_metadata then raise exception 'IMAGE_SET_REVISION_CONFLICT';end if;
 if not(item.metadata ? 'portfolioImageSet') then raise exception 'IMAGE_SET_LEGACY_ALREADY_RESTORED';end if;
 if (p_next_metadata-keys) is distinct from(item.metadata-keys)
  or ((p_next_metadata->'generated')-'bodyHtml') is distinct from((item.metadata->'generated')-'bodyHtml')
  or ((p_next_metadata->'styleRevision')-'fingerprint') is distinct from((item.metadata->'styleRevision')-'fingerprint')
  or (p_next_metadata->'portfolioAssets') is distinct from(history.previous_metadata->'portfolioAssets')
  or (p_next_metadata->'portfolioMockup') is distinct from(history.previous_metadata->'portfolioMockup')
  or (p_next_metadata->'manualMockupOverride') is distinct from(history.previous_metadata->'manualMockupOverride')
  or p_next_metadata ? 'portfolioImageSet' or p_next_metadata ? 'portfolioThumbnailVersion'
  or jsonb_typeof(p_next_metadata#>'{generated,bodyHtml}') is distinct from 'string' then raise exception 'IMAGE_SET_PROTECTED_FIELDS_CHANGED';end if;
 perform set_config('woolim.verified_image_write','on',true);
 delete from public.content_review_assets where work_item_id=p_work_item_id and asset_type in('thumbnail','body_image');
 insert into public.content_review_assets
  select a.* from jsonb_populate_recordset(null::public.content_review_assets,history.previous_review_assets) a
  where a.work_item_id=p_work_item_id and a.asset_type in('thumbnail','body_image');
 at:=greatest(now(),item.updated_at+interval '1 microsecond');
 update public.content_work_items set metadata=p_next_metadata,updated_at=at where id=p_work_item_id;
 return jsonb_build_object('workItemId',p_work_item_id,'activeSetId',null,'updatedAt',at,'restoredHistoryId',p_history_id);
end;$$;
revoke all on function public.restore_legacy_portfolio_images(uuid,uuid,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.restore_legacy_portfolio_images(uuid,uuid,timestamptz,jsonb,jsonb,text) to service_role;
