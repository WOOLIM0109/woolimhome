-- Narrow covering indexes avoid scanning the bloated heap to rank the day's live targets.
create index openchat_program_matches_rank_delta_idx
  on public.openchat_program_matches(review_date,program_id,score desc)
  where verdict <> 'mismatch';
create index openchat_program_matches_flag_delta_idx
  on public.openchat_program_matches(review_date,program_id,selected_for_reading) include(verdict);

-- Parse obsolete targets once and skip no-op upserts of large reason arrays.
-- Preserve ranking, completion checkpoints, locks, signature and service-only ACLs.
create or replace function public.save_openchat_program_matches(p_program_id uuid, p_review_date date, p_input_hash text, p_matches jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare selected_program_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('requirements:' || p_program_id::text, 0));
  if not exists (select 1 from public.openchat_program_requirements where program_id=p_program_id
      and input_hash=p_input_hash and status='extracted') then raise exception 'Stale requirements'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_review_date::text, 0));
  insert into public.openchat_program_matches as existing
    (program_id,target_kind,target_id,target_name,verdict,reasons,score,review_date)
    select p_program_id,m->>'targetKind',m->>'targetId',m->>'targetName',m->>'verdict',
      m->'reasons',(m->>'score')::numeric,p_review_date
    from pg_catalog.jsonb_array_elements(p_matches) m
    on conflict(program_id,target_kind,target_id,review_date) do update set
      target_name=excluded.target_name,verdict=excluded.verdict,reasons=excluded.reasons,
      score=excluded.score
    where (existing.target_name,existing.verdict,existing.reasons,existing.score)
      is distinct from (excluded.target_name,excluded.verdict,excluded.reasons,excluded.score);
  -- Shred the full payload once, instead of once for each of the program's target rows.
  with expected_targets as materialized (
    select x."targetKind" as target_kind,x."targetId" as target_id
    from pg_catalog.jsonb_to_recordset(p_matches) as x("targetKind" text,"targetId" text)
  )
  delete from public.openchat_program_matches m where m.program_id=p_program_id
    and m.review_date=p_review_date and not exists (
      select 1 from expected_targets expected
      where expected.target_kind=m.target_kind and expected.target_id=m.target_id
    );
  select coalesce(array_agg(chosen.program_id),'{}'::uuid[]) into selected_program_ids
  from (
    select x.program_id from public.openchat_program_matches x
    join public.openchat_programs p on p.id=x.program_id
    where x.review_date=p_review_date and x.verdict <> 'mismatch' and p.status <> 'excluded'
      and (p.deadline_at is null or p.deadline_at >= now())
    group by x.program_id order by max(x.score) desc,x.program_id limit 8
  ) chosen;
  -- Touch only old selected rows that leave the set, and new selected rows.
  -- No full-day expected-selection self join or all-row flag rewrite is needed.
  update public.openchat_program_matches m set selected_for_reading=false
    where m.review_date=p_review_date and m.selected_for_reading
      and (m.verdict='mismatch' or not(m.program_id=any(selected_program_ids)));
  update public.openchat_program_matches m set selected_for_reading=true
    where m.review_date=p_review_date and m.program_id=any(selected_program_ids)
      and m.verdict <> 'mismatch' and not m.selected_for_reading;
  -- Commit the completion marker only after target rows and selection both succeed.
  -- A timed-out transaction leaves the old marker due even when old matches exist.
  update public.openchat_program_requirements
    set matched_normalization_version=normalization_version,matched_review_date=p_review_date,
      matched_source_checked_at=source_checked_at
    where program_id=p_program_id and input_hash=p_input_hash and status='extracted';
end;
$$;
