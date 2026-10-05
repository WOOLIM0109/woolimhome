create table public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  track text not null check (track in ('consulting', 'business-docs', 'design', 'etc')),
  name text not null,
  phone text not null,
  email text,
  message text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  notified_at timestamptz,
  notify_error text,
  source_path text,
  requester_key text
);

alter table public.contact_inquiries enable row level security;

-- 공개 API 키와 일반 로그인 사용자는 조회·수정할 수 없습니다.
-- 서버의 service role만 접수 저장과 알림 상태 갱신에 사용합니다.
revoke all on table public.contact_inquiries from public, anon, authenticated;
grant select, insert, update on table public.contact_inquiries to service_role;
