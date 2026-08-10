-- Keep the usage-log recovery path bounded and indexable. The normal cache
-- remains one row per provider result; this array is only a recovery pointer
-- when the independent cache upsert failed after a successful provider call.
alter table public.content_automation_runs
  add column if not exists gemini_review_provider_ids text[] not null default '{}';

-- Backfill successful provider ids from logs written before this column was
-- introduced. Failed ids are deliberately excluded so they remain eligible
-- for an explicitly confirmed retry.
with reusable as (
  select
    run.id,
    array_agg(distinct result.value ->> 'id') as provider_ids
  from public.content_automation_runs run
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(run.metrics #> '{mergedResult,results}') = 'array'
        then run.metrics #> '{mergedResult,results}'
      when jsonb_typeof(run.metrics #> '{result,results}') = 'array'
        then run.metrics #> '{result,results}'
      else '[]'::jsonb
    end
  ) result(value)
  where run.cron_name = 'gemini-review-log'
    and run.status = 'completed'
    and run.metrics @> '{"networkRequest":true}'::jsonb
    and result.value ->> 'status' in ('passed', 'needs_revision')
    and nullif(result.value ->> 'id', '') is not null
  group by run.id
)
update public.content_automation_runs run
set gemini_review_provider_ids = reusable.provider_ids
from reusable
where run.id = reusable.id
  and cardinality(run.gemini_review_provider_ids) = 0;

create index if not exists content_automation_runs_gemini_review_provider_ids_idx
  on public.content_automation_runs using gin (gemini_review_provider_ids)
  where cron_name = 'gemini-review-log'
    and status = 'completed';

comment on column public.content_automation_runs.gemini_review_provider_ids is
  'Successful stable Gemini review provider ids in this usage log. GIN-indexed only for bounded cache recovery.';
