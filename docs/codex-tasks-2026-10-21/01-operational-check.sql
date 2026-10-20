-- Read-only. Run after the 2026-10-21 09:10 KST attachment invocation completes.
-- Keep the observation date identical in every query and report it with the results.
with daily as (
  select p.* from public.openchat_programs p
  where p.created_at >= timestamptz '2026-10-21 00:00:00+09'
    and p.created_at < timestamptz '2026-10-22 00:00:00+09'
), eligible as (
  select * from daily where status <> 'excluded' and (deadline_at is null or deadline_at >= now())
), documents as (
  select a.program_id,
    count(*) filter (where file_ext <> 'zip') as document_count,
    count(*) filter (where file_ext <> 'zip' and text_status = 'extracted') as extracted_count,
    count(*) filter (where file_ext <> 'zip' and text_status = 'failed') as failed_count,
    count(*) filter (where file_ext <> 'zip' and text_status = 'no_text') as no_text_count,
    count(*) filter (where file_ext <> 'zip' and text_status = 'skipped') as skipped_count,
    string_agg(distinct error, '; ') filter (where error is not null and file_ext <> 'zip') as errors
  from public.openchat_program_attachments a join eligible p on p.id = a.program_id
  group by a.program_id
)
select s.name as institution,
  (select count(*) from daily p where p.source_id = s.id) as collected_programs,
  count(p.id) as eligible_programs,
  count(p.id) filter (where d.status = 'found') as programs_with_attachments,
  count(p.id) filter (where docs.document_count > 0 and docs.document_count = docs.extracted_count) as fully_extracted_programs,
  coalesce(sum(docs.document_count),0) as attachment_documents,
  coalesce(sum(docs.extracted_count),0) as extracted_documents,
  coalesce(sum(docs.failed_count),0) as failed_documents,
  coalesce(sum(docs.no_text_count),0) as no_text_documents,
  coalesce(sum(docs.skipped_count),0) as skipped_documents,
  count(p.id) filter (where d.program_id is null) as discovery_pending,
  string_agg(distinct coalesce(d.error,docs.errors), '; ') as failure_reasons,
  s.last_succeeded_at, s.last_status
from public.openchat_sources s
left join eligible p on p.source_id = s.id
left join public.openchat_program_attachment_discovery d on d.program_id = p.id
left join documents docs on docs.program_id = p.id
group by s.id,s.name,s.priority,s.last_succeeded_at,s.last_status
order by s.priority,s.name;

-- ZIP containers are excluded from document counts. A notice is only complete
-- when every expanded/downloaded document is extracted, not merely one of them.
with eligible as (
  select id from public.openchat_programs
  where created_at >= timestamptz '2026-10-21 00:00:00+09'
    and created_at < timestamptz '2026-10-22 00:00:00+09'
    and status <> 'excluded' and (deadline_at is null or deadline_at >= now())
), per_program as (
  select p.id,d.status,
    count(a.id) filter (where a.file_ext <> 'zip') as documents,
    count(a.id) filter (where a.file_ext <> 'zip' and a.text_status='extracted') as extracted
  from eligible p
  left join public.openchat_program_attachment_discovery d on d.program_id=p.id
  left join public.openchat_program_attachments a on a.program_id=p.id
  group by p.id,d.status
)
select now() as observed_at,
  count(*) as eligible_programs,
  count(*) filter (where status='found') as attachment_programs,
  count(*) filter (where status='found' and documents>0 and documents=extracted) as fully_extracted_programs,
  round(100.0 * count(*) filter (where status='found' and documents>0 and documents=extracted)
    / nullif(count(*) filter (where status='found'),0),2) as extracted_program_percent,
  count(*) filter (where status is null or status='failed') as unresolved_discovery
from per_program;

select task,status,started_at,finished_at,summary,error
from public.openchat_run_logs
where task in ('morning-collect','attachments')
  and started_at >= timestamptz '2026-10-21 00:00:00+09'
  and started_at < timestamptz '2026-10-22 00:00:00+09'
order by started_at;
