-- Independent private review track. Existing publication rows and schedules are untouched.
create table public.openchat_program_attachment_discovery (
  program_id uuid primary key references public.openchat_programs(id) on delete cascade,
  status text not null check (status in ('found', 'none', 'failed')),
  attachment_count integer not null default 0,
  detail_text text not null default '',
  error text,
  checked_at timestamptz not null default now()
);

create table public.openchat_program_attachments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.openchat_programs(id) on delete cascade,
  parent_id uuid references public.openchat_program_attachments(id) on delete cascade,
  file_name text not null,
  file_ext text not null check (file_ext in ('hwp', 'hwpx', 'pdf', 'zip', 'unknown')),
  source_url text not null,
  storage_path text,
  byte_size bigint check (byte_size >= 0),
  sha256 text,
  text_status text not null default 'pending'
    check (text_status in ('pending', 'extracted', 'no_text', 'failed', 'skipped')),
  text_content text,
  text_chars integer not null default 0 check (text_chars >= 0),
  error text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  extracted_at timestamptz,
  unique (program_id, source_url)
);
create index openchat_program_attachments_hash_idx
  on public.openchat_program_attachments (sha256) where sha256 is not null;
create index openchat_program_attachments_pending_idx
  on public.openchat_program_attachments (created_at) where text_status in ('pending', 'failed');

alter table public.openchat_program_attachments enable row level security;
alter table public.openchat_program_attachment_discovery enable row level security;
revoke all on public.openchat_program_attachments from public, anon, authenticated;
revoke all on public.openchat_program_attachment_discovery from public, anon, authenticated;
grant all on public.openchat_program_attachments to service_role;
grant all on public.openchat_program_attachment_discovery to service_role;

-- Atomic claim prevents overlapping cron invocations from processing the same file.
create function public.claim_openchat_attachment(attachment_id uuid)
returns setof public.openchat_program_attachments
language sql security invoker set search_path = '' as $$
  update public.openchat_program_attachments a
     set processing_started_at = now(), attempts = attempts + 1
   where a.id = attachment_id
     and a.text_status in ('pending', 'failed') and a.attempts < 3
     and (a.processing_started_at is null or a.processing_started_at < now() - interval '10 minutes')
     and exists (
       select 1 from public.openchat_programs p where p.id = a.program_id
       and p.status <> 'excluded' and (p.deadline_at is null or p.deadline_at >= now())
     )
  returning a.*;
$$;
revoke all on function public.claim_openchat_attachment(uuid) from public, anon, authenticated;
grant execute on function public.claim_openchat_attachment(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('program-attachments', 'program-attachments', false, 31457280)
on conflict (id) do update set public = false, file_size_limit = 31457280;
