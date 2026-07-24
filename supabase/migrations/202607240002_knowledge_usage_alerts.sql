alter table public.column_expert_knowledge
  add column if not exists use_count integer not null default 0
    check (use_count >= 0),
  add column if not exists last_used_at timestamptz;

create index if not exists column_expert_knowledge_usage_idx
  on public.column_expert_knowledge (approved, use_count, created_at desc);

comment on column public.column_expert_knowledge.use_count is
  'Number of generated columns that used this approved source.';
comment on column public.column_expert_knowledge.last_used_at is
  'Most recent time this source was used in a generated column.';
