-- Prepared only: apply after explicit approval. Never import history here.
create table public.portfolio_publication_ledger (
  id uuid primary key default gen_random_uuid(),
  normalized_project_name text not null check (length(normalized_project_name) > 0),
  blog_url text not null unique check (blog_url ~ '^https://blog[.]naver[.]com/wl_0109/[0-9]+$'),
  title text not null check (length(title) > 0),
  published_at timestamptz,
  drive_file_id uuid references public.naver_works_drive_files(id) on delete set null,
  candidate_id uuid references public.portfolio_candidates(id) on delete set null,
  work_item_id uuid references public.content_work_items(id) on delete set null,
  representative_hashes jsonb not null default '[]'::jsonb check (jsonb_typeof(representative_hashes) = 'array'),
  source text not null check (source in ('auto','manual','history')),
  created_at timestamptz not null default now()
);
create index portfolio_publication_project_idx on public.portfolio_publication_ledger(normalized_project_name);
alter table public.portfolio_publication_ledger enable row level security;
revoke all on public.portfolio_publication_ledger from public, anon, authenticated;
grant select, insert, update, delete on public.portfolio_publication_ledger to service_role;
