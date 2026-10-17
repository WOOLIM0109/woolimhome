-- Prepared only. No history backfill and no existing rows are changed.
create or replace function public.record_portfolio_publication() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare evidence jsonb;
begin
  if new.channel <> 'naver_design' or new.format <> 'portfolio' or new.status <> 'published'
    or new.published_url_normalized is null then return new; end if;
  evidence := new.metadata -> 'portfolioPublication';
  perform pg_advisory_xact_lock(hashtextextended('portfolio-selection',0));
  if nullif(evidence ->> 'normalizedProjectName','') is null then
    raise exception 'PORTFOLIO_PUBLICATION_EVIDENCE_REQUIRED';
  end if;
  insert into public.portfolio_publication_ledger
    (normalized_project_name,blog_url,title,published_at,drive_file_id,candidate_id,work_item_id,representative_hashes,source)
  values (evidence->>'normalizedProjectName',new.published_url_normalized,new.title,new.published_at,
    (evidence->>'driveFileId')::uuid,(evidence->>'candidateId')::uuid,new.id,
    coalesce(evidence->'representativeHashes','[]'::jsonb),'auto')
  on conflict (blog_url) do update set work_item_id = excluded.work_item_id
    where portfolio_publication_ledger.normalized_project_name = excluded.normalized_project_name
      and (portfolio_publication_ledger.work_item_id is null or portfolio_publication_ledger.work_item_id = excluded.work_item_id);
  if not found then raise exception 'PORTFOLIO_PUBLICATION_CONFLICT'; end if;
  return new;
end; $$;
revoke all on function public.record_portfolio_publication() from public,anon,authenticated;
grant execute on function public.record_portfolio_publication() to service_role;
create trigger portfolio_publication_registered after insert or update of status,published_url_normalized
  on public.content_work_items for each row execute function public.record_portfolio_publication();

create or replace function public.exclude_published_portfolio_candidate(
  p_candidate_id uuid, p_updated_at timestamptz, p_project_name text, p_url text, p_title text, p_published_at timestamptz
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare candidate public.portfolio_candidates%rowtype; ledger_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('portfolio-selection',0));
  select * into candidate from public.portfolio_candidates where id=p_candidate_id for update;
  if not found or candidate.status <> 'candidate' or candidate.updated_at <> p_updated_at
    or exists(select 1 from public.content_jobs where candidate_id=p_candidate_id)
    or exists(select 1 from public.content_work_items where metadata->>'candidateId'=p_candidate_id::text) then
    raise exception 'PORTFOLIO_CANDIDATE_CHANGED';
  end if;
  insert into public.portfolio_publication_ledger
    (normalized_project_name,blog_url,title,published_at,drive_file_id,candidate_id,representative_hashes,source)
  values(p_project_name,p_url,p_title,p_published_at,candidate.drive_file_id,candidate.id,
    coalesce(candidate.metadata->'representativeHashes','[]'::jsonb),'manual')
  on conflict(blog_url) do update set blog_url=excluded.blog_url
    where portfolio_publication_ledger.normalized_project_name=excluded.normalized_project_name
  returning id into ledger_id;
  if ledger_id is null then raise exception 'PORTFOLIO_PUBLICATION_CONFLICT'; end if;
  update public.portfolio_candidates set status='excluded', duplicate_score=100,
    exclusion_reasons=array['중복: '||p_title||' ('||p_url||')'],
    metadata=metadata||jsonb_build_object('duplicateMatch',jsonb_build_object('title',p_title,'url',p_url,'ledgerId',ledger_id)),
    updated_at=now() where id=p_candidate_id;
  return ledger_id;
end; $$;
revoke all on function public.exclude_published_portfolio_candidate(uuid,timestamptz,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.exclude_published_portfolio_candidate(uuid,timestamptz,text,text,text,timestamptz) to service_role;
