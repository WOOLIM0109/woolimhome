alter table public.openchat_programs
  add column if not exists application_period_text text not null default '';
