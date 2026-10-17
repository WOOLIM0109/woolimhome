-- Prepared only. This migration does not delete rows or storage objects.
-- Immutable shared manifests must survive deletion of their original owner.
alter table public.portfolio_image_sets alter column work_item_id drop not null;
alter table public.portfolio_image_sets drop constraint portfolio_image_sets_work_item_id_fkey;
alter table public.portfolio_image_sets add constraint portfolio_image_sets_work_item_id_fkey
 foreign key(work_item_id) references public.content_work_items(id) on delete set null;
create or replace function public.purge_naver_design_on_hold(p_snapshot jsonb,p_retained_set_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[]; candidate_ids uuid[]; linked_candidate_ids uuid[]; table_name text; mismatch boolean; actual_count integer; expected_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('portfolio-selection',0));
 if exists(select 1 from portfolio_automation_control where first_run_approved) then raise exception 'PURGE_REQUIRES_RESTART_PAUSED'; end if;
 -- Locks prevent new child references, approvals, worker claims or image swaps
 -- between verification of the backup and the commit.
 lock table content_work_items,content_jobs,portfolio_candidates,content_review_assets,content_workers,
  portfolio_image_sets,portfolio_image_set_activations,portfolio_mockup_sessions,
  portfolio_thumbnail_versions,portfolio_thumbnail_version_activations,portfolio_thumbnail_candidates,content_publication_events
  in share row exclusive mode;
 select coalesce(array_agg((item->>'id')::uuid),'{}') into ids from jsonb_array_elements(p_snapshot->'content_work_items') item;
 select coalesce(array_agg((item->>'id')::uuid),'{}') into candidate_ids from jsonb_array_elements(p_snapshot->'portfolio_candidates') item;
 if cardinality(ids)=0 then return jsonb_build_object('deleted',0); end if;
 select coalesce(array_agg(distinct candidate_id),'{}') into linked_candidate_ids from (
  select (metadata->>'candidateId')::uuid candidate_id from content_work_items where id=any(ids)
  union all select candidate_id from content_jobs where work_item_id=any(ids)
 ) linked where candidate_id is not null;
 if not(candidate_ids @> linked_candidate_ids and linked_candidate_ids @> candidate_ids) then
  raise exception 'PURGE_CANDIDATE_SCOPE_MISMATCH'; end if;
 if exists(select 1 from content_work_items where id=any(ids) and (channel<>'naver_design' or status<>'on_hold'
  or published_at is not null or published_url is not null or published_url_normalized is not null))
  or (select count(*) from content_work_items where channel='naver_design' and status='on_hold')<>cardinality(ids)
 then raise exception 'PURGE_TARGET_CHANGED'; end if;
 if exists(select 1 from content_jobs where candidate_id=any(candidate_ids) and (work_item_id is null or not(work_item_id=any(ids))))
  or exists(select 1 from content_work_items where not(id=any(ids)) and metadata->>'candidateId'=any(candidate_ids::text[]))
  or exists(select 1 from content_jobs where work_item_id=any(ids) and status in('running','pc_running'))
  or exists(select 1 from portfolio_mockup_sessions where work_item_id=any(ids) and status in('preparing','uploading'))
  or exists(select 1 from content_workers where current_job_id in(select id from content_jobs where work_item_id=any(ids)))
 then raise exception 'PURGE_SHARED_OR_RUNNING_TARGET'; end if;
 foreach table_name in array array['content_work_items','content_jobs','portfolio_candidates','content_review_assets',
  'portfolio_image_sets','portfolio_image_set_activations','portfolio_mockup_sessions','portfolio_thumbnail_versions',
  'portfolio_thumbnail_version_activations','portfolio_thumbnail_candidates','content_publication_events'] loop
  if jsonb_typeof(p_snapshot->table_name) is distinct from 'array' then raise exception 'PURGE_BACKUP_MISSING: %',table_name; end if;
  expected_count:=jsonb_array_length(p_snapshot->table_name);
  execute format('select count(*) from public.%I t where %s',table_name,
   case when table_name='content_work_items' then 'id=any($1)' when table_name='portfolio_candidates' then 'id=any($2)' else 'work_item_id=any($1)' end)
   into actual_count using ids,candidate_ids;
  execute format('select exists(select 1 from jsonb_array_elements($1) j left join public.%1$I t on t.id=(j->>''id'')::uuid where t.id is null or to_jsonb(t) is distinct from to_jsonb(jsonb_populate_record(null::public.%1$I,j)))',table_name)
   into mismatch using p_snapshot->table_name;
  if actual_count<>expected_count or mismatch then raise exception 'PURGE_BACKUP_STALE: %',table_name; end if;
 end loop;
 -- Reject an obsolete retained-set plan; FK constraints add a second barrier.
 if exists(select 1 from portfolio_image_sets s where s.work_item_id=any(ids) and not(s.id=any(p_retained_set_ids)) and exists(
  select 1 from (
   select to_jsonb(w)::text body from content_work_items w where not(w.id=any(ids))
   union all select to_jsonb(a)::text from content_review_assets a where not(a.work_item_id=any(ids))
   union all select to_jsonb(a)::text from portfolio_image_set_activations a where not(a.work_item_id=any(ids))
   union all select to_jsonb(v)::text from portfolio_thumbnail_versions v where not(v.work_item_id=any(ids))
   union all select to_jsonb(v)::text from portfolio_thumbnail_candidates v where not(v.work_item_id=any(ids))
  ) refs where strpos(refs.body,s.id::text)>0)) then raise exception 'PURGE_SHARED_IMAGE_SET'; end if;
 -- Narrow maintenance exception, after exact backup/ownership validation.
 -- Keep direct writes to immutable image tables revoked from service_role.
 perform set_config('woolim.verified_image_write','on',true);
 delete from content_review_assets where work_item_id=any(ids);
 delete from portfolio_image_set_activations where work_item_id=any(ids);
 delete from portfolio_image_sets where work_item_id=any(ids) and not(id=any(p_retained_set_ids));
 delete from portfolio_mockup_sessions where work_item_id=any(ids);
 delete from content_jobs where work_item_id=any(ids);
 update portfolio_candidates set status='candidate',duplicate_score=0,font_status='unchecked',missing_fonts='{}',
  selection_reasons='{}',exclusion_reasons='{}',
  metadata=jsonb_build_object('source','naver_works_drive','fileSizeMegabytes',metadata->'fileSizeMegabytes'),
  updated_at=now() where id=any(candidate_ids);
 delete from content_work_items where id=any(ids);
 return jsonb_build_object('deleted',cardinality(ids),'resetCandidates',candidate_ids,'retainedSets',p_retained_set_ids);
end; $$;
revoke all on function public.purge_naver_design_on_hold(jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.purge_naver_design_on_hold(jsonb,uuid[]) to service_role;
