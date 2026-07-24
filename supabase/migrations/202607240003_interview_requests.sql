alter table public.column_expert_knowledge
  add column if not exists expertise_area text not null default 'general'
    check (expertise_area in (
      'planning', 'design', 'government_support', 'business_plan',
      'ir_ppt', 'management', 'general'
    ));

create index if not exists column_expert_knowledge_area_idx
  on public.column_expert_knowledge (expertise_area, approved, use_count, created_at desc);

create table if not exists public.column_interview_requests (
  id uuid primary key default gen_random_uuid(),
  expertise_area text not null
    check (expertise_area in (
      'planning', 'design', 'government_support', 'business_plan',
      'ir_ppt', 'management', 'general'
    )),
  title text not null,
  rationale text not null,
  recommended_minutes integer not null default 40
    check (recommended_minutes between 15 and 90),
  questions jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  generation_metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists column_interview_requests_status_idx
  on public.column_interview_requests (status, expertise_area, created_at desc);

alter table public.column_interview_requests enable row level security;
revoke all on public.column_interview_requests from anon, authenticated;

comment on table public.column_interview_requests is
  'AI-generated long-form interview guides for replenishing Woolim expert knowledge.';
