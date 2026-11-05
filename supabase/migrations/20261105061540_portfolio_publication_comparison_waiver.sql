alter table public.portfolio_publication_ledger
  add column if not exists comparison_waiver jsonb not null default '[]'::jsonb
  check (jsonb_typeof(comparison_waiver) = 'array');
