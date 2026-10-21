-- SELECT-only operational checks for 2026-10-21 KST. Run with a private admin connection.
-- Execute after the profile cache and requirement task finish; keep each observed_at with its result.
-- If comparing several observations at one exact instant, replace each now() in the bounds CTE
-- with the SAME explicit timestamptz. Change every report_date together for another reporting day.
-- No customer names, original customer IDs, full raw JSON, API credentials, errors, or request headers
-- are projected. Customer IDs are used internally only for joins and deterministic anonymous numbering.
-- Counts from a day with 19 created rows and 1 currently eligible row must remain separate:
-- created_at is collection registration time, not an assertion that all 19 are still open.

/* ============================================================================
   01. Daily funnel: collected -> eligible -> complete attachments -> requirements
       -> candidate/unknown reading pool. Counts are PROGRAMS unless named *_rows
       or *_documents. unknown is retained for human review; it is not candidate.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date, now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), daily as (
  select p.id,p.source_id,p.status,p.deadline_at
  from public.openchat_programs p cross join bounds b
  where p.created_at >= b.day_start and p.created_at < b.day_end
), eligible as (
  select p.* from daily p cross join bounds b
  where p.status <> 'excluded' and (p.deadline_at is null or p.deadline_at >= b.observed_at)
), documents as (
  select p.id as program_id,
    count(a.id) filter (where a.file_ext <> 'zip') as documents,
    count(a.id) filter (where a.file_ext <> 'zip' and a.text_status='extracted'
      and length(coalesce(a.text_content,'')) > 0) as extracted_documents,
    count(a.id) filter (where a.file_ext='zip' and not (
      exists (select 1 from public.openchat_program_attachments child where child.parent_id=a.id)
      or (a.text_status='skipped' and coalesce(a.error,'')='ZIP 내 지원 문서 없음')
    )) as unresolved_zip_containers
  from eligible p left join public.openchat_program_attachments a on a.program_id=p.id
  group by p.id
), match_counts as (
  select m.program_id,
    count(*) filter (where m.verdict='candidate') as candidate_rows,
    count(*) filter (where m.verdict='unknown') as unknown_rows,
    count(*) filter (where m.verdict='mismatch') as mismatch_rows,
    bool_or(m.verdict in ('candidate','unknown')) as in_reading_pool,
    bool_or(m.selected_for_reading) as selected
  from public.openchat_program_matches m join eligible p on p.id=m.program_id
  cross join bounds b where m.review_date=b.report_date
  group by m.program_id
), facts as (
  select p.id,d.status as discovery_status,docs.documents,docs.extracted_documents,
    (d.status='found' and docs.documents>0 and docs.documents=docs.extracted_documents
      and docs.unresolved_zip_containers=0) as fully_extracted,
    r.status as requirement_status,
    coalesce(mc.candidate_rows,0) as candidate_rows,
    coalesce(mc.unknown_rows,0) as unknown_rows,
    coalesce(mc.mismatch_rows,0) as mismatch_rows,
    coalesce(mc.in_reading_pool,false) as in_reading_pool,
    coalesce(mc.selected,false) as selected
  from eligible p
  join documents docs on docs.program_id=p.id
  left join public.openchat_program_attachment_discovery d on d.program_id=p.id
  left join public.openchat_program_requirements r on r.program_id=p.id
  left join match_counts mc on mc.program_id=p.id
), collection_totals as (
  select count(*) as collected_programs,
    count(*) filter (where p.status='excluded') as excluded_programs,
    count(*) filter (where p.status<>'excluded' and p.deadline_at < b.observed_at) as expired_nonexcluded_programs,
    count(*) filter (where p.source_id is null) as programs_without_source
  from daily p cross join bounds b
)
select b.report_date,b.observed_at,c.collected_programs,c.excluded_programs,
  c.expired_nonexcluded_programs,c.programs_without_source,
  count(f.id) as eligible_programs,
  count(f.id) filter (where f.discovery_status='found') as programs_with_attachments,
  count(f.id) filter (where f.fully_extracted) as fully_extracted_programs,
  coalesce(sum(f.documents),0) as attachment_documents,
  coalesce(sum(f.extracted_documents),0) as extracted_documents,
  count(f.id) filter (where f.discovery_status is null or f.discovery_status='failed') as unresolved_discovery_programs,
  count(f.id) filter (where f.requirement_status='extracted') as requirements_extracted_programs,
  count(f.id) filter (where f.requirement_status='processing') as requirements_processing_programs,
  count(f.id) filter (where f.requirement_status='failed') as requirements_failed_programs,
  coalesce(sum(f.candidate_rows),0) as candidate_match_rows,
  coalesce(sum(f.unknown_rows),0) as unknown_match_rows,
  coalesce(sum(f.mismatch_rows),0) as mismatch_match_rows,
  count(f.id) filter (where f.in_reading_pool) as candidate_or_unknown_programs,
  count(f.id) filter (where f.selected) as selected_distinct_programs
from bounds b cross join collection_totals c left join facts f on true
group by b.report_date,b.observed_at,c.collected_programs,c.excluded_programs,
  c.expired_nonexcluded_programs,c.programs_without_source;

/* ============================================================================
   02. Per-target funnel, with fixed self labels and anonymous customer labels.
       Customer numbering is target_id sort order across this day's complete cache
       plus matches, BEFORE filtering today's collected cohort. It is deterministic
       for the same snapshot; it is not a globally permanent customer identifier.
       Shared collection/attachment stages are repeated, not attributed to a customer.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date, now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), daily as (
  select p.id,p.status,p.deadline_at from public.openchat_programs p cross join bounds b
  where p.created_at>=b.day_start and p.created_at<b.day_end
), eligible as (
  select p.id from daily p cross join bounds b
  where p.status<>'excluded' and (p.deadline_at is null or p.deadline_at>=b.observed_at)
), complete_attachments as (
  select p.id from eligible p
  join public.openchat_program_attachment_discovery d on d.program_id=p.id and d.status='found'
  where exists (select 1 from public.openchat_program_attachments a
      where a.program_id=p.id and a.file_ext<>'zip')
    and not exists (select 1 from public.openchat_program_attachments a where a.program_id=p.id
      and ((a.file_ext<>'zip' and (a.text_status<>'extracted' or length(coalesce(a.text_content,''))=0))
        or (a.file_ext='zip' and not (
          exists (select 1 from public.openchat_program_attachments child where child.parent_id=a.id)
          or (a.text_status='skipped' and coalesce(a.error,'')='ZIP 내 지원 문서 없음')))))
), customer_ids as (
  select m.target_id from public.openchat_program_matches m cross join bounds b
  where m.review_date=b.report_date and m.target_kind='customer'
  union
  select item->>'id' from public.openchat_match_profiles_cache c cross join bounds b
  cross join lateral jsonb_array_elements(c.payload) item
  where c.cache_date=b.report_date and c.fetched_at is not null and c.expires_at>b.observed_at
    and jsonb_typeof(item->'id')='string' and length(item->>'id')>0
), numbered_customers as (
  select target_id,row_number() over (order by target_id) as ordinal from customer_ids
), labels as (
  select 'self'::text as target_kind,'woolim-company'::text as target_id,'울림컴퍼니'::text as target_label,1::bigint as sort_order
  union all select 'self','cellavento','셀라벤토',2::bigint
  union all
  select 'customer',target_id,
    '고객' || lpad(ordinal::text,greatest(3,length(ordinal::text)),'0'),ordinal+2
  from numbered_customers
), common_counts as (
  select (select count(*) from daily) as collected_programs,
    (select count(*) from eligible) as eligible_programs,
    (select count(*) from complete_attachments) as fully_extracted_programs,
    (select count(*) from eligible p join public.openchat_program_requirements r on r.program_id=p.id
      where r.status='extracted') as requirements_extracted_programs
), today_matches as (
  select m.target_kind,m.target_id,m.program_id,m.verdict,m.selected_for_reading
  from public.openchat_program_matches m join eligible p on p.id=m.program_id
  cross join bounds b where m.review_date=b.report_date
)
select b.report_date,b.observed_at,l.target_kind,l.target_label,
  c.collected_programs,c.eligible_programs,c.fully_extracted_programs,c.requirements_extracted_programs,
  count(m.program_id) filter (where m.verdict='candidate') as candidate_programs,
  count(m.program_id) filter (where m.verdict='unknown') as unknown_programs,
  count(m.program_id) filter (where m.verdict='mismatch') as mismatch_programs,
  count(m.program_id) filter (where m.verdict in ('candidate','unknown')) as candidate_or_unknown_programs,
  count(m.program_id) filter (where m.selected_for_reading) as selected_programs
from labels l cross join bounds b cross join common_counts c
left join today_matches m on m.target_kind=l.target_kind and m.target_id=l.target_id
group by b.report_date,b.observed_at,l.target_kind,l.target_label,l.sort_order,
  c.collected_programs,c.eligible_programs,c.fully_extracted_programs,c.requirements_extracted_programs
order by l.sort_order;

/* ============================================================================
   03. Global DAILY eight-program cap, including older notices reviewed today.
       This scope deliberately differs from today's created_at cohort in 01/02.
       Invalid selected-program counts should all be zero; selected_programs<=8.
   ============================================================================ */
with bounds as (select date '2026-10-21' as report_date,now() as observed_at)
select b.report_date,b.observed_at,
  count(distinct m.program_id) filter (where m.selected_for_reading) as selected_programs,
  (count(distinct m.program_id) filter (where m.selected_for_reading)<=8) as within_eight_program_cap,
  count(distinct m.program_id) filter (where m.selected_for_reading and p.status='excluded') as selected_excluded_programs,
  count(distinct m.program_id) filter (where m.selected_for_reading and p.deadline_at<b.observed_at) as selected_expired_programs,
  count(*) filter (where m.selected_for_reading and m.verdict='mismatch') as selected_mismatch_rows,
  count(distinct m.program_id) filter (where m.selected_for_reading and r.status is distinct from 'extracted') as selected_without_extracted_requirements,
  count(distinct m.program_id) filter (where m.verdict in ('candidate','unknown') and p.status<>'excluded'
    and (p.deadline_at is null or p.deadline_at>=b.observed_at)) as currently_eligible_reading_pool_programs
from bounds b
left join public.openchat_program_matches m on m.review_date=b.report_date
left join public.openchat_programs p on p.id=m.program_id
left join public.openchat_program_requirements r on r.program_id=m.program_id
group by b.report_date,b.observed_at;

/* ============================================================================
   04. Cache completion/progress and lease status. Never project payload/state.
       finished cache: fetched_at set and expires_at later than observed_at.
       Staging contains all customers being checked, not confirmed active targets.
   ============================================================================ */
with bounds as (select date '2026-10-21' as report_date,now() as observed_at)
select b.report_date,b.observed_at,
  case when c.cache_date is null then 'missing'
    when c.fetched_at is not null and c.expires_at>b.observed_at then 'complete'
    when c.refresh_owner is not null and c.refresh_expires_at>b.observed_at then 'refreshing'
    when c.refresh_state is not null then 'staging'
    when c.fetched_at is not null then 'expired' else 'empty' end as cache_status,
  c.fetched_at,c.expires_at,
  coalesce(c.refresh_owner is not null and c.refresh_expires_at>b.observed_at,false) as lease_active,
  coalesce(jsonb_array_length(c.payload),0) as completed_customer_profiles,
  case when jsonb_typeof(c.refresh_state->'customers')='array'
    then jsonb_array_length(c.refresh_state->'customers') else 0 end as staged_customer_profiles,
  case when jsonb_typeof(c.refresh_state->'cursor')='number'
    then (c.refresh_state->>'cursor')::numeric else 0 end as checked_customer_cursor,
  (select count(*) from jsonb_array_elements(coalesce(c.payload,'[]'::jsonb)) item
    where jsonb_typeof(item)<>'object' or exists (
      select 1 from jsonb_object_keys(case when jsonb_typeof(item)='object' then item else '{}'::jsonb end) k(key)
      where k.key not in ('id','name','region','foundedOn','hasSupportHistory')
    )) as completed_rows_with_unexpected_fields,
  (select count(*) from jsonb_array_elements(case when jsonb_typeof(c.refresh_state->'customers')='array'
      then c.refresh_state->'customers' else '[]'::jsonb end) item
    where jsonb_typeof(item)<>'object' or exists (
      select 1 from jsonb_object_keys(case when jsonb_typeof(item)='object' then item else '{}'::jsonb end) k(key)
      where k.key not in ('id','name','region','foundedOn','hasSupportHistory','hasRecentProject')
    )) as staged_rows_with_unexpected_fields
from bounds b left join public.openchat_match_profiles_cache c on c.cache_date=b.report_date;

/* ============================================================================
   05. Requirement processing/failure counts, separated by cohort.
       No raw errors, requirement JSON, input hashes, or source text are projected.
       Attempts are counted separately because an immutable attempt is not a result.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date,now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), scopes(scope) as (values ('today_created_eligible'),('attempted_today')),
statuses(status) as (values ('processing'),('extracted'),('failed')),
scoped_requirements as (
  select 'today_created_eligible'::text as scope,r.program_id,r.status,r.source_complete,r.input_truncated,r.attempted_at
  from public.openchat_program_requirements r join public.openchat_programs p on p.id=r.program_id
  cross join bounds b where p.created_at>=b.day_start and p.created_at<b.day_end
    and p.status<>'excluded' and (p.deadline_at is null or p.deadline_at>=b.observed_at)
  union all
  select 'attempted_today',r.program_id,r.status,r.source_complete,r.input_truncated,r.attempted_at
  from public.openchat_program_requirements r cross join bounds b
  where r.attempted_at>=b.day_start and r.attempted_at<b.day_end
)
select b.report_date,b.observed_at,s.scope,st.status,count(r.program_id) as requirement_programs,
  count(r.program_id) filter (where r.source_complete=false) as incomplete_source_programs,
  count(r.program_id) filter (where r.input_truncated=true) as truncated_input_programs,
  count(r.program_id) filter (where r.status='processing' and r.attempted_at<b.observed_at-interval '10 minutes') as stale_processing_programs,
  (select count(*) from public.openchat_program_requirement_attempts a
    where a.attempted_at>=b.day_start and a.attempted_at<b.day_end) as all_immutable_attempts_today
from bounds b cross join scopes s cross join statuses st
left join scoped_requirements r on r.scope=s.scope and r.status=st.status
group by b.report_date,b.observed_at,b.day_start,b.day_end,s.scope,st.status
order by s.scope,st.status;

/* ============================================================================
   06. Requirement operation's Gemini budget ledger: numbers and fixed status only.
       A pre-call budget rejection has no automation-log row; zero rows alone do
       not prove an attempt was never deferred. Check task summary separately.
       networkAttempts is the ledger's accounting value, not an independent
       network trace. Do not add metrics/errorMessage/provider IDs to the output.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date,now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), statuses(status) as (values ('running'),('completed'),('failed'),('skipped')),
ledger as (
  select r.status,
    case when jsonb_typeof(r.metrics->'reservedNetworkAttempts')='number' then (r.metrics->>'reservedNetworkAttempts')::numeric else 0 end as reserved_attempts,
    case when jsonb_typeof(r.metrics->'networkAttempts')='number' then (r.metrics->>'networkAttempts')::numeric else 0 end as reported_attempts,
    case when jsonb_typeof(r.metrics->'inputTokens')='number' then (r.metrics->>'inputTokens')::numeric else 0 end as input_tokens,
    case when jsonb_typeof(r.metrics->'outputTokens')='number' then (r.metrics->>'outputTokens')::numeric else 0 end as output_tokens,
    case when jsonb_typeof(r.metrics->'estimatedCostUsd')='number' then (r.metrics->>'estimatedCostUsd')::numeric else 0 end as estimated_cost_usd,
    case when jsonb_typeof(r.metrics->'accountedCostUsd')='number' then (r.metrics->>'accountedCostUsd')::numeric else 0 end as accounted_cost_usd
  from public.content_automation_runs r cross join bounds b
  where r.cron_name='gemini-automation-log' and r.metrics->>'operation'='program-review-requirements'
    and r.created_at>=b.day_start and r.created_at<b.day_end
)
select b.report_date,b.observed_at,s.status,count(l.status) as ledger_rows,
  coalesce(sum(l.reserved_attempts),0) as reserved_network_attempts,
  coalesce(sum(l.reported_attempts),0) as ledger_reported_network_attempts,
  coalesce(sum(l.input_tokens),0) as input_tokens,
  coalesce(sum(l.output_tokens),0) as output_tokens,
  coalesce(sum(l.estimated_cost_usd),0) as estimated_cost_usd,
  coalesce(sum(l.accounted_cost_usd),0) as accounted_cost_usd
from bounds b cross join statuses s left join ledger l on l.status=s.status
group by b.report_date,b.observed_at,s.status order by s.status;

/* ============================================================================
   07. Institution table: one row per registered source, including zero-count rows.
       Expect 21 rows for the seeded 21 sources; do not filter to enabled sources.
       collected counts all today's registrations, other stages use currently
       eligible notices. ZIP containers are not document counts. No raw errors.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date,now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), daily as (
  select p.id,p.source_id,p.status,p.deadline_at from public.openchat_programs p cross join bounds b
  where p.created_at>=b.day_start and p.created_at<b.day_end
), collected as (
  select source_id,count(*) as programs from daily group by source_id
), eligible as (
  select p.* from daily p cross join bounds b
  where p.status<>'excluded' and (p.deadline_at is null or p.deadline_at>=b.observed_at)
), documents as (
  select p.id as program_id,
    count(a.id) filter (where a.file_ext<>'zip') as documents,
    count(a.id) filter (where a.file_ext<>'zip' and a.text_status='extracted'
      and length(coalesce(a.text_content,''))>0) as extracted_documents,
    count(a.id) filter (where a.file_ext<>'zip' and a.text_status='pending') as pending_documents,
    count(a.id) filter (where a.file_ext<>'zip' and a.text_status='failed') as failed_documents,
    count(a.id) filter (where a.file_ext<>'zip' and a.text_status='no_text') as no_text_documents,
    count(a.id) filter (where a.file_ext<>'zip' and a.text_status='skipped') as skipped_documents,
    count(a.id) filter (where a.file_ext='zip' and not (
      exists (select 1 from public.openchat_program_attachments child where child.parent_id=a.id)
      or (a.text_status='skipped' and coalesce(a.error,'')='ZIP 내 지원 문서 없음')
    )) as unresolved_zip_containers
  from eligible p left join public.openchat_program_attachments a on a.program_id=p.id
  group by p.id
), match_counts as (
  select m.program_id,
    count(*) filter (where m.verdict='candidate') as candidate_rows,
    count(*) filter (where m.verdict='unknown') as unknown_rows,
    count(*) filter (where m.verdict='mismatch') as mismatch_rows,
    bool_or(m.verdict in ('candidate','unknown')) as in_reading_pool,
    bool_or(m.selected_for_reading) as selected
  from public.openchat_program_matches m join eligible p on p.id=m.program_id
  cross join bounds b where m.review_date=b.report_date group by m.program_id
)
select b.report_date,b.observed_at,s.source_key,s.name as institution,
  coalesce(c.programs,0) as collected_programs,count(p.id) as eligible_programs,
  count(p.id) filter (where d.status='found') as programs_with_attachments,
  count(p.id) filter (where d.status='found' and docs.documents>0
    and docs.documents=docs.extracted_documents and docs.unresolved_zip_containers=0) as fully_extracted_programs,
  coalesce(sum(docs.documents),0) as attachment_documents,
  coalesce(sum(docs.extracted_documents),0) as extracted_documents,
  coalesce(sum(docs.pending_documents),0) as pending_documents,
  coalesce(sum(docs.failed_documents),0) as failed_documents,
  coalesce(sum(docs.no_text_documents),0) as no_text_documents,
  coalesce(sum(docs.skipped_documents),0) as skipped_documents,
  coalesce(sum(docs.unresolved_zip_containers),0) as unresolved_zip_containers,
  count(p.id) filter (where d.program_id is null or d.status='failed') as unresolved_discovery_programs,
  count(p.id) filter (where r.status='extracted') as requirements_extracted_programs,
  count(p.id) filter (where r.status='processing') as requirements_processing_programs,
  count(p.id) filter (where r.status='failed') as requirements_failed_programs,
  coalesce(sum(mc.candidate_rows),0) as candidate_match_rows,
  coalesce(sum(mc.unknown_rows),0) as unknown_match_rows,
  coalesce(sum(mc.mismatch_rows),0) as mismatch_match_rows,
  count(p.id) filter (where mc.in_reading_pool) as candidate_or_unknown_programs,
  count(p.id) filter (where mc.selected) as selected_distinct_programs
from public.openchat_sources s cross join bounds b
left join collected c on c.source_id=s.id
left join eligible p on p.source_id=s.id
left join documents docs on docs.program_id=p.id
left join public.openchat_program_attachment_discovery d on d.program_id=p.id
left join public.openchat_program_requirements r on r.program_id=p.id
left join match_counts mc on mc.program_id=p.id
group by b.report_date,b.observed_at,s.id,s.source_key,s.name,s.priority,c.programs
order by s.priority,s.name;

/* ============================================================================
   08. Expanded manual review scope, including existing excluded notices.
       Explicit future deadlines and unknown deadlines MUST be reported separately.
       "recent60_all_open_or_unknown" overlaps the next two rows; do not add it to
       them. Daily rows likewise overlap. Earlier 01/02 remain the original daily
       NONEXCLUDED flow; these rows do not reinterpret excluded as publishable.
       A notice with any extracted text is not necessarily fully extracted.
       The >=50 check concerns extracted requirements, not attachments or attempts.
   ============================================================================ */
with bounds as (
  select date '2026-10-21' as report_date,now() as observed_at,
    timestamptz '2026-10-21 00:00:00+09' as day_start,
    timestamptz '2026-10-22 00:00:00+09' as day_end
), scopes(scope,daily_only,deadline_kind) as (
  values ('recent60_all_open_or_unknown',false,'all'),('recent60_explicit_future',false,'known'),
    ('recent60_deadline_unknown',false,'unknown'),('daily_all_open_or_unknown',true,'all'),
    ('daily_explicit_future',true,'known'),('daily_deadline_unknown',true,'unknown')
), scoped as (
  select s.scope,p.id,p.status from scopes s cross join bounds b
  join public.openchat_programs p on p.created_at>=b.observed_at-interval '60 days'
    and (p.deadline_at is null or p.deadline_at>=b.observed_at)
    and (not s.daily_only or (p.created_at>=b.day_start and p.created_at<b.day_end))
    and (s.deadline_kind='all' or (s.deadline_kind='known' and p.deadline_at is not null)
      or (s.deadline_kind='unknown' and p.deadline_at is null))
), documents as (
  select a.program_id,count(*) filter(where a.file_ext<>'zip') as documents,
    count(*) filter(where a.file_ext<>'zip' and a.text_status='extracted'
      and length(coalesce(a.text_content,''))>0) as extracted_documents,
    count(*) filter(where a.file_ext<>'zip' and a.text_status='pending') as pending_documents,
    count(*) filter(where a.file_ext<>'zip' and a.text_status='failed') as failed_documents,
    count(*) filter(where a.file_ext<>'zip' and a.text_status='no_text') as no_text_documents,
    count(*) filter(where a.file_ext<>'zip' and a.text_status='skipped') as skipped_documents,
    count(*) filter(where a.file_ext='zip' and not (
      exists(select 1 from public.openchat_program_attachments child where child.parent_id=a.id)
      or (a.text_status='skipped' and coalesce(a.error,'')='ZIP 내 지원 문서 없음')
    )) as unresolved_zip_containers
  from public.openchat_program_attachments a
  where exists(select 1 from scoped p where p.id=a.program_id) group by a.program_id
), matches as (
  select m.program_id,count(*) filter(where m.verdict='candidate') as candidates,
    count(*) filter(where m.verdict='unknown') as unknowns,
    count(*) filter(where m.verdict='mismatch') as mismatches,
    bool_or(m.verdict in ('candidate','unknown')) as in_reading_pool,
    bool_or(m.selected_for_reading) as selected
  from public.openchat_program_matches m cross join bounds b
  where m.review_date=b.report_date and exists(select 1 from scoped p where p.id=m.program_id)
  group by m.program_id
)
select b.report_date,b.observed_at,s.scope,count(p.id) as scoped_programs,
  count(p.id) filter(where p.status='excluded') as excluded_test_only_programs,
  count(p.id) filter(where p.status<>'excluded') as nonexcluded_programs,
  case when s.daily_only then (select count(*) from public.openchat_programs all_daily
    where all_daily.created_at>=b.day_start and all_daily.created_at<b.day_end) end as daily_all_collected_programs,
  count(p.id) filter(where d.program_id is null) as discovery_not_attempted_programs,
  count(p.id) filter(where d.status='found') as discovery_found_programs,
  count(p.id) filter(where d.status='none') as discovery_none_programs,
  count(p.id) filter(where d.status='failed') as discovery_failed_programs,
  count(p.id) filter(where docs.extracted_documents>0) as programs_with_any_extracted_text,
  count(p.id) filter(where d.status='found' and docs.documents>0
    and docs.documents=docs.extracted_documents and docs.unresolved_zip_containers=0) as fully_extracted_programs,
  coalesce(sum(docs.documents),0) as attachment_documents,
  coalesce(sum(docs.extracted_documents),0) as extracted_documents,
  coalesce(sum(docs.pending_documents),0) as pending_documents,
  coalesce(sum(docs.failed_documents),0) as failed_documents,
  coalesce(sum(docs.no_text_documents),0) as no_text_documents,
  coalesce(sum(docs.skipped_documents),0) as skipped_documents,
  coalesce(sum(docs.unresolved_zip_containers),0) as unresolved_zip_containers,
  count(p.id) filter(where r.status='extracted') as requirements_extracted_programs,
  (count(p.id) filter(where r.status='extracted')>=50) as at_least_fifty_extracted_requirements,
  count(p.id) filter(where r.status='processing') as requirements_processing_programs,
  count(p.id) filter(where r.status='failed') as requirements_failed_programs,
  count(p.id) filter(where r.program_id is null) as requirements_not_attempted_programs,
  coalesce(sum(m.candidates),0) as candidate_match_rows,
  coalesce(sum(m.unknowns),0) as unknown_match_rows,
  coalesce(sum(m.mismatches),0) as mismatch_match_rows,
  count(p.id) filter(where m.in_reading_pool) as candidate_or_unknown_programs,
  count(p.id) filter(where m.selected) as selected_distinct_programs
from bounds b cross join scopes s left join scoped p on p.scope=s.scope
left join documents docs on docs.program_id=p.id
left join public.openchat_program_attachment_discovery d on d.program_id=p.id
left join public.openchat_program_requirements r on r.program_id=p.id
left join matches m on m.program_id=p.id
group by b.report_date,b.observed_at,b.day_start,b.day_end,s.scope,s.daily_only
order by s.scope;

/* ============================================================================
   09. Expanded per-target funnel. Customer labels use the same cache+match ID
       numbering as 02; customer identity values are never projected. Each target
       has separate known-future / deadline-unknown rows, including zero matches.
       The common collection/text stages are repeated, not customer attribution.
   ============================================================================ */
with bounds as (select date '2026-10-21' as report_date,now() as observed_at),
scopes(scope) as (values('recent60_explicit_future'),('recent60_deadline_unknown')),
eligible as (
  select p.id,case when p.deadline_at is null then 'recent60_deadline_unknown'
    else 'recent60_explicit_future' end as scope
  from public.openchat_programs p cross join bounds b
  where p.created_at>=b.observed_at-interval '60 days' and (p.deadline_at is null or p.deadline_at>=b.observed_at)
), customer_ids as (
  select m.target_id from public.openchat_program_matches m cross join bounds b
  where m.review_date=b.report_date and m.target_kind='customer'
  union
  select item->>'id' from public.openchat_match_profiles_cache c cross join bounds b
  cross join lateral jsonb_array_elements(c.payload) item
  where c.cache_date=b.report_date and c.fetched_at is not null and c.expires_at>b.observed_at
    and jsonb_typeof(item->'id')='string' and length(item->>'id')>0
), numbered_customers as (
  select target_id,row_number() over(order by target_id) as ordinal from customer_ids
), labels as (
  select 'self'::text as target_kind,'woolim-company'::text as target_id,'울림컴퍼니'::text as target_label,1::bigint as sort_order
  union all select 'self','cellavento','셀라벤토',2::bigint
  union all select 'customer',target_id,'고객'||lpad(ordinal::text,greatest(3,length(ordinal::text)),'0'),ordinal+2
  from numbered_customers
), common as (
  select s.scope,count(p.id) as eligible_programs,
    count(p.id) filter(where exists(select 1 from public.openchat_program_attachments a
      where a.program_id=p.id and a.text_status='extracted' and length(coalesce(a.text_content,''))>0)) as programs_with_any_extracted_text,
    count(p.id) filter(where r.status='extracted') as requirements_extracted_programs
  from scopes s left join eligible p on p.scope=s.scope
  left join public.openchat_program_requirements r on r.program_id=p.id group by s.scope
), today_matches as (
  select p.scope,m.target_kind,m.target_id,m.program_id,m.verdict,m.selected_for_reading
  from public.openchat_program_matches m join eligible p on p.id=m.program_id
  cross join bounds b where m.review_date=b.report_date
)
select b.report_date,b.observed_at,s.scope,l.target_kind,l.target_label,
  c.eligible_programs,c.programs_with_any_extracted_text,c.requirements_extracted_programs,
  count(m.program_id) filter(where m.verdict='candidate') as candidate_programs,
  count(m.program_id) filter(where m.verdict='unknown') as unknown_programs,
  count(m.program_id) filter(where m.verdict='mismatch') as mismatch_programs,
  count(m.program_id) filter(where m.verdict in ('candidate','unknown')) as candidate_or_unknown_programs,
  count(m.program_id) filter(where m.selected_for_reading) as selected_programs
from bounds b cross join labels l cross join scopes s join common c on c.scope=s.scope
left join today_matches m on m.scope=s.scope and m.target_kind=l.target_kind and m.target_id=l.target_id
group by b.report_date,b.observed_at,s.scope,l.target_kind,l.target_label,l.sort_order,
  c.eligible_programs,c.programs_with_any_extracted_text,c.requirements_extracted_programs
order by l.sort_order,s.scope;

/* ============================================================================
   10. Random TEN extracted public notices for manual field/input comparison.
       Future deadlines only; no customer joins. Random sampling changes on each
       execution: save the ten public program IDs with the observed_at if auditing
       the same sample again. Original source excerpts are bounded to 4,000 chars
       per document / 2,000 detail chars; these are public notice inputs only.
       A displayed evidence quote is not a completed human accuracy assessment.
   ============================================================================ */
with bounds as (select date '2026-10-21' as report_date,now() as observed_at),
sample as (
  select p.id,p.title,p.deadline_at,p.status,r.requirements,r.source_complete,r.input_truncated,r.extracted_at
  from public.openchat_programs p join public.openchat_program_requirements r on r.program_id=p.id
  cross join bounds b where p.created_at>=b.observed_at-interval '60 days'
    and p.deadline_at>=b.observed_at and r.status='extracted'
  order by random() limit 10
)
select b.report_date,b.observed_at,p.id as public_program_id,p.title,p.deadline_at,
  (p.status='excluded') as excluded_test_only,p.extracted_at,p.source_complete,p.input_truncated,
  p.requirements->'regions' as regions,p.requirements->'target_types' as target_types,
  p.requirements->'business_age' as business_age,p.requirements->'size' as size,
  p.requirements->'industries_included' as industries_included,
  p.requirements->'industries_excluded' as industries_excluded,
  p.requirements->'required_certifications' as required_certifications,
  p.requirements->'bonus_points' as bonus_points,
  p.requirements->>'support_amount_text' as support_amount_text,p.requirements->>'self_pay_text' as self_pay_text,
  p.requirements->>'deadline_at' as extracted_deadline_at,
  p.requirements->'submission_documents' as submission_documents,p.requirements->'evaluation' as evaluation,
  p.requirements->>'contact' as public_notice_contact,
  (select jsonb_object_agg(e.key,e.value) from jsonb_each_text(case when jsonb_typeof(p.requirements->'evidence')='object'
    then p.requirements->'evidence' else '{}'::jsonb end) e
    where e.key ~ '^(regions|target_types|business_age|size|industries_included|industries_excluded|required_certifications|bonus_points|support_amount_text|self_pay_text|deadline_at|submission_documents|evaluation|contact)(\.|$)') as public_source_evidence,
  left(d.detail_text,2000) as public_detail_excerpt,
  (select jsonb_agg(jsonb_build_object('public_attachment_id',a.id,'file_ext',a.file_ext,
    'text_chars',length(a.text_content),'excerpt',left(a.text_content,4000)) order by a.id)
    from public.openchat_program_attachments a where a.program_id=p.id and a.text_status='extracted'
      and length(coalesce(a.text_content,''))>0) as public_attachment_excerpts
from sample p cross join bounds b left join public.openchat_program_attachment_discovery d on d.program_id=p.id
order by p.id;

/* ============================================================================
   11. Private per-target top FIVE candidate/unknown matches for the expanded
       confirmed-open scope. Anonymous labels only; NEVER select target_name,
       target_id, cache names, or full profile payloads into the result.
       Existing excluded rows are test-only and never publication approval.
       Rows with unknown verdict require review; this is not an eligibility claim.
   ============================================================================ */
with bounds as (select date '2026-10-21' as report_date,now() as observed_at),
customer_ids as (
  select m.target_id from public.openchat_program_matches m cross join bounds b
  where m.review_date=b.report_date and m.target_kind='customer'
  union
  select item->>'id' from public.openchat_match_profiles_cache c cross join bounds b
  cross join lateral jsonb_array_elements(c.payload) item
  where c.cache_date=b.report_date and c.fetched_at is not null and c.expires_at>b.observed_at
    and jsonb_typeof(item->'id')='string' and length(item->>'id')>0
), numbered_customers as (
  select target_id,row_number() over(order by target_id) as ordinal from customer_ids
), labels as (
  select 'self'::text as target_kind,'woolim-company'::text as target_id,'울림컴퍼니'::text as target_label,1::bigint as sort_order
  union all select 'self','cellavento','셀라벤토',2::bigint
  union all select 'customer',target_id,'고객'||lpad(ordinal::text,greatest(3,length(ordinal::text)),'0'),ordinal+2
  from numbered_customers
), ranked as (
  select l.target_kind,l.target_label,l.sort_order,p.id as public_program_id,p.title,p.deadline_at,
    (p.status='excluded') as excluded_test_only,m.verdict,m.score,m.reasons,m.selected_for_reading,
    row_number() over(partition by m.target_kind,m.target_id order by m.score desc,p.deadline_at,p.id) as target_rank
  from public.openchat_program_matches m join public.openchat_programs p on p.id=m.program_id
  join public.openchat_program_requirements r on r.program_id=p.id and r.status='extracted'
  join labels l on l.target_kind=m.target_kind and l.target_id=m.target_id
  cross join bounds b where m.review_date=b.report_date and m.verdict in ('candidate','unknown')
    and p.created_at>=b.observed_at-interval '60 days' and p.deadline_at>=b.observed_at
)
select b.report_date,b.observed_at,r.target_kind,r.target_label,r.target_rank,r.public_program_id,r.title,r.deadline_at,
  r.excluded_test_only,r.verdict,r.score,r.reasons,r.selected_for_reading
from ranked r cross join bounds b where r.target_rank<=5 order by r.sort_order,r.target_rank;
