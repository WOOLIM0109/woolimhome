-- The initial production run stays disabled until cleanup + preview approval.
create table public.portfolio_automation_control (
  id boolean primary key default true check(id),
  first_run_approved boolean not null default false,
  hash_threshold integer check(hash_threshold between 0 and 8),
  calibration_evidence text,
  approved_at timestamptz,
  check(not first_run_approved or (hash_threshold is not null and calibration_evidence is not null and approved_at is not null))
);
insert into public.portfolio_automation_control(id) values(true);
alter table public.portfolio_automation_control enable row level security;
revoke all on public.portfolio_automation_control from public,anon,authenticated;
grant select,update on public.portfolio_automation_control to service_role;

create or replace function public.reserve_deduplicated_portfolio_candidate(
 p_id uuid,p_updated_at timestamptz,p_normalized_name text,p_metadata jsonb,p_work_item jsonb
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare work_id uuid; threshold integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('portfolio-selection',0));
 select hash_threshold into threshold from portfolio_automation_control where first_run_approved;
 if not exists(select 1 from portfolio_automation_control where first_run_approved)
   or nullif(p_normalized_name,'') is null or (p_metadata->>'dedupeVersion') is distinct from 'project-dedupe-v1'
   or jsonb_array_length(coalesce(p_metadata->'representativeHashes','[]'))=0
   then raise exception 'PORTFOLIO_RESTART_APPROVAL_REQUIRED'; end if;
 if exists(select 1 from portfolio_publication_ledger where normalized_project_name=p_normalized_name)
   or exists(select 1 from portfolio_candidates where id<>p_id and status in('selected','processed','on_hold')
     and metadata->>'normalizedProjectName'=p_normalized_name)
   or exists(select 1 from content_work_items where schedule_key=p_work_item->>'schedule_key') then return null; end if;
 -- Serialize against another reservation or publication after the read-only inspection.
 if exists(select 1 from (
   select representative_hashes hashes from portfolio_publication_ledger
   union all select coalesce(metadata->'representativeHashes','[]') from portfolio_candidates
     where id<>p_id and status in('selected','processed','on_hold')
 ) refs cross join lateral jsonb_array_elements_text(refs.hashes) b
 cross join jsonb_array_elements_text(p_metadata->'representativeHashes') a
 where case when a.value ~ '^[a-fA-F0-9]{16}$' and b.value ~ '^[a-fA-F0-9]{16}$'
   then bit_count(('x'||a.value)::bit(64)) between 8 and 56
     and bit_count(('x'||b.value)::bit(64)) between 8 and 56
     and bit_count(('x'||a.value)::bit(64) # ('x'||b.value)::bit(64))<=threshold else false end)
 then return null; end if;
 update portfolio_candidates set status='selected',metadata=p_metadata,updated_at=now(),
   duplicate_score=(p_metadata->>'duplicateScore')::numeric,quality_score=(p_metadata->>'selectionScore')::numeric,
   selection_reasons=array(select jsonb_array_elements_text(p_metadata->'selectionReasons'))
   where id=p_id and status='candidate' and updated_at=p_updated_at;
 if not found then return null; end if;
 insert into content_work_items(channel,format,title,summary,status,source_label,source_reference,scheduled_at,schedule_key,created_by,metadata)
 values('naver_design','portfolio',p_work_item->>'title',p_work_item->>'summary','researching',
   p_work_item->>'source_label',p_work_item->>'source_reference',(p_work_item->>'scheduled_at')::timestamptz,
   p_work_item->>'schedule_key',p_work_item->>'created_by',p_work_item->'metadata') returning id into work_id;
 update portfolio_candidates set metadata=metadata||jsonb_build_object('workItemId',work_id,'selectedAt',now()) where id=p_id;
 insert into content_jobs(candidate_id,work_item_id,job_type,status,payload)
 select p_id,work_id,step,case when ord=1 then 'queued' else 'on_hold' end,
   jsonb_build_object('stepOrder',ord,'waitsFor',lag(step) over(order by ord),'driveFileId',p_work_item->'metadata'->>'driveFileId')
 from unnest(array['download','convert','font_check','privacy_check','mockup','draft']) with ordinality steps(step,ord);
 return work_id;
end; $$;
revoke all on function public.reserve_deduplicated_portfolio_candidate(uuid,timestamptz,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_deduplicated_portfolio_candidate(uuid,timestamptz,text,jsonb,jsonb) to service_role;

-- Even a legacy/manual queue path must not send an unchecked file to a PC.
create or replace function public.guard_portfolio_conversion_dedupe() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.job_type='convert' and new.status in('queued','running','pc_waiting','pc_running') then
   if not exists(select 1 from portfolio_automation_control where first_run_approved)
     or not exists(select 1 from portfolio_candidates where id=new.candidate_id and status<>'excluded'
       and metadata->>'dedupeVersion'='project-dedupe-v1') then
     raise exception 'PORTFOLIO_DEDUPE_REQUIRED';
   end if;
 end if;
 return new;
end; $$;
revoke all on function public.guard_portfolio_conversion_dedupe() from public,anon,authenticated;
grant execute on function public.guard_portfolio_conversion_dedupe() to service_role;
create trigger portfolio_conversion_dedupe_guard before insert or update of status on public.content_jobs
 for each row execute function public.guard_portfolio_conversion_dedupe();
