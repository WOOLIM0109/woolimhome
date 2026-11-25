-- 고객사에 공고를 보낸 기록 (2026-11-26)
--
-- 관리 화면 '고객사 전달' 탭은 그날 고객사마다 맞는 공고를 모아 보낼 문구를 만든다.
-- 직원이 문구를 복사해 고객사 카톡방에 붙인 뒤 '보냈어요' 를 누르면 여기에 한 줄이 남는다.
--   - 같은 공고가 같은 고객사에 두 번 가지 않게 한다 (다음 날 문구에서 뺀다)
--   - 누가 언제 보냈는지 남긴다
-- 자동 발송은 하지 않는다. 이 표는 사람이 보낸 것을 적어 두는 곳이다.
create table public.openchat_program_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- 울림웍스 고객 id. 사업자(entity) 단위가 아니라 고객사 단위로 보낸다.
  customer_id text not null check (length(customer_id) between 1 and 160),
  program_id uuid not null references public.openchat_programs(id) on delete cascade,
  -- 그 공고를 어느 판정 날짜의 문구로 보냈는지
  review_date date not null,
  delivered_by text not null check (length(delivered_by) between 1 and 200),
  delivered_at timestamptz not null default now(),
  unique (customer_id, program_id)
);
-- 고객사별로 고르는 조회는 위 unique 가 맡는다. 아래 둘은
--   '오늘 보낸 것' (보낸 시각으로 고른다) 과 공고가 지워질 때 함께 지우는 일에 쓴다.
-- 공고가 지워지면 보낸 기록도 같이 지워진다 (다른 공고 표들과 같은 규칙).
create index openchat_program_deliveries_delivered_idx
  on public.openchat_program_deliveries (delivered_at desc);
create index openchat_program_deliveries_program_idx
  on public.openchat_program_deliveries (program_id);

alter table public.openchat_program_deliveries enable row level security;
revoke all on public.openchat_program_deliveries from public, anon, authenticated, service_role;
-- 고치지는 않는다(update 권한 없음 — 그래서 API 는 insert … on conflict do nothing 만 쓴다).
-- 잘못 누른 것은 지워서 되돌린다 (화면의 "되돌리기").
grant select, insert, delete on public.openchat_program_deliveries to service_role;
