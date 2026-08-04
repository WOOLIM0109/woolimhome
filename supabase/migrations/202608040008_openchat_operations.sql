create table if not exists public.openchat_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  category text not null,
  name text not null,
  base_url text not null,
  listing_url text not null,
  collection_method text not null default 'page'
    check (collection_method in ('page', 'json', 'manual')),
  priority integer not null default 100,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_succeeded_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.openchat_programs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.openchat_sources(id) on delete set null,
  external_id text,
  fingerprint text not null unique,
  title text not null,
  applicant_summary text not null default '',
  support_summary text not null default '',
  application_method text not null default '',
  source_url text not null,
  starts_at timestamptz,
  deadline_at timestamptz,
  regions text[] not null default '{}',
  categories text[] not null default '{}',
  status text not null default 'review_required'
    check (status in (
      'collected', 'review_required', 'approved', 'deferred',
      'excluded', 'ready', 'published'
    )),
  priority integer not null default 100,
  draft_for date,
  exclusion_reason text,
  review_note text,
  raw_payload jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by text,
  ready_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists openchat_programs_queue_idx
  on public.openchat_programs (draft_for, status, priority, deadline_at, created_at desc);

create table if not exists public.openchat_content_history (
  id uuid primary key default gen_random_uuid(),
  published_on date,
  content_kind text not null default 'afternoon'
    check (content_kind in ('afternoon', 'support_program', 'reference_material')),
  title text not null,
  summary text not null default '',
  keywords text[] not null default '{}',
  source_label text,
  created_at timestamptz not null default now(),
  unique (published_on, title)
);

create table if not exists public.openchat_content_drafts (
  id uuid primary key default gen_random_uuid(),
  content_date date not null unique,
  weekday_theme text not null,
  title text not null,
  body text not null default '',
  reference_urls text[] not null default '{}',
  keywords text[] not null default '{}',
  similarity_score integer not null default 0 check (similarity_score between 0 and 100),
  similar_history_ids uuid[] not null default '{}',
  status text not null default 'review_required'
    check (status in ('topic_candidate', 'review_required', 'approved', 'deferred', 'ready', 'published', 'on_hold')),
  review_note text,
  approved_at timestamptz,
  approved_by text,
  ready_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.openchat_run_logs (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists public.openchat_holidays (
  holiday_date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.openchat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.openchat_sources enable row level security;
alter table public.openchat_programs enable row level security;
alter table public.openchat_content_history enable row level security;
alter table public.openchat_content_drafts enable row level security;
alter table public.openchat_run_logs enable row level security;
alter table public.openchat_holidays enable row level security;
alter table public.openchat_push_subscriptions enable row level security;

revoke all on public.openchat_sources from anon, authenticated;
revoke all on public.openchat_programs from anon, authenticated;
revoke all on public.openchat_content_history from anon, authenticated;
revoke all on public.openchat_content_drafts from anon, authenticated;
revoke all on public.openchat_run_logs from anon, authenticated;
revoke all on public.openchat_holidays from anon, authenticated;
revoke all on public.openchat_push_subscriptions from anon, authenticated;

insert into public.openchat_sources
  (source_key, category, name, base_url, listing_url, collection_method, priority)
values
  ('bizinfo', '중앙부처', '기업마당', 'https://www.bizinfo.go.kr', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?pageIndex=1', 'page', 10),
  ('mss', '중앙부처', '중소벤처기업부', 'https://www.mss.go.kr', 'https://www.mss.go.kr/site/smba/ex/bbs/List.do?cbIdx=310', 'page', 20),
  ('kstartup', '중앙부처', 'K-Startup', 'https://www.k-startup.go.kr', 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancClssCd=PBC010', 'page', 5),
  ('sbiz24', '소상공인', '소상공인24', 'https://www.sbiz24.kr', 'https://www.sbiz24.kr/', 'page', 30),
  ('semas', '소상공인', '소상공인시장진흥공단', 'https://www.semas.or.kr', 'https://www.semas.or.kr/web/board/webBoardList.kmdc?bCd=1&pNm=BOA0101', 'page', 35),
  ('btp', '부울경', '부산테크노파크', 'https://www.btp.or.kr', 'https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&mgr_seq=16', 'page', 15),
  ('smart_factory', '전문기관', '스마트공장관리시스템', 'https://www.smart-factory.kr', 'https://www.smart-factory.kr/', 'page', 45),
  ('ripc', '전문기관', 'IP지역지식재산센터', 'https://pms.ripc.org', 'https://pms.ripc.org/pms/cmn/bizMain.do', 'page', 45),
  ('fanfandaero', '소상공인', '판판대로', 'https://fanfandaero.kr', 'https://fanfandaero.kr/portal/v2/preSprtBizPbanc.do', 'page', 35),
  ('yeongdo', '부울경', '영도구청', 'https://www.yeongdo.go.kr', 'https://www.yeongdo.go.kr/00000/00007/00008.web', 'page', 25),
  ('busanstartup', '부울경', '부산창업포털', 'https://www.busanstartup.kr', 'https://www.busanstartup.kr/_Api/bizListData?deadline=N&mcode=biz02&pageNo=1&s_orderby=regi&s_desc=desc&deleteYn=N', 'json', 10),
  ('spobiz', '전문기관', '국민체육진흥공단 스포츠산업지원', 'https://spobiz.kspo.or.kr', 'https://spobiz.kspo.or.kr/front/index.do', 'page', 60),
  ('gjtp', '기타지역', '광주테크노파크', 'https://www.gjtp.or.kr', 'https://www.gjtp.or.kr/home/main.cs', 'page', 90),
  ('ols_semas', '소상공인', '소상공인 정책자금', 'https://ols.semas.or.kr', 'https://ols.semas.or.kr/ols/man/SMAN010M/page.do', 'page', 35),
  ('touraz', '전문기관', '한국관광산업포털', 'https://touraz.kr', 'https://touraz.kr/announcementList?tabMode=ktoip', 'page', 55),
  ('bsbukgu', '부울경', '부산 북구청', 'https://www.bsbukgu.go.kr', 'https://www.bsbukgu.go.kr/index.bsbukgu?menuCd=DOM_000000105001005000', 'page', 25),
  ('bepa', '부울경', '부산경제진흥원', 'https://www.bepa.kr', 'https://www.bepa.kr/kor/view.do?no=1502', 'page', 15),
  ('bsdonggu', '부울경', '부산 동구', 'https://www.bsdonggu.go.kr', 'https://www.bsdonggu.go.kr/index.donggu?menuCd=DOM_000000103001002000', 'page', 25),
  ('mssmiv', '중앙부처', '중소기업 혁신바우처', 'https://www.mssmiv.com', 'https://www.mssmiv.com/portal/Main', 'page', 40),
  ('rms', '전문기관', '기업지원관리시스템(RMS)', 'https://www.smtech.go.kr', 'https://www.smtech.go.kr/region/rms', 'page', 50),
  ('smtech', '중앙부처', '중소기업기술개발지원사업 통합공고', 'https://www.smtech.go.kr', 'https://www.smtech.go.kr/front/main/main.do', 'page', 25)
on conflict (source_key) do update set
  name = excluded.name,
  listing_url = excluded.listing_url,
  priority = excluded.priority,
  updated_at = now();

insert into public.openchat_holidays (holiday_date, name)
values
  ('2026-01-01', '신정'),
  ('2026-02-16', '설날 연휴'),
  ('2026-02-17', '설날'),
  ('2026-02-18', '설날 연휴'),
  ('2026-03-02', '삼일절 대체공휴일'),
  ('2026-05-05', '어린이날'),
  ('2026-05-25', '부처님오신날 대체공휴일'),
  ('2026-06-03', '전국동시지방선거'),
  ('2026-08-17', '광복절 대체공휴일'),
  ('2026-09-24', '추석 연휴'),
  ('2026-09-25', '추석'),
  ('2026-09-26', '추석 연휴'),
  ('2026-09-28', '추석 대체공휴일'),
  ('2026-10-05', '개천절 대체공휴일'),
  ('2026-10-09', '한글날'),
  ('2026-12-25', '성탄절')
on conflict (holiday_date) do update set name = excluded.name;

insert into public.openchat_content_history
  (published_on, content_kind, title, keywords, source_label)
values
  ('2026-05-27', 'afternoon', '판판대로 활용법', array['판판대로','판로','온라인판매'], '카카오톡 내보내기'),
  ('2026-05-29', 'afternoon', '소비자가 불편함에 비용을 지불하는 이유', array['소비트렌드','불편함','가치'], '카카오톡 내보내기'),
  ('2026-06-01', 'afternoon', '지역지식재산센터 활용법', array['RIPC','지식재산','특허'], '카카오톡 내보내기'),
  ('2026-06-02', 'afternoon', '업무용 검색·요약 AI 도구', array['AI','검색','요약'], '카카오톡 내보내기'),
  ('2026-06-05', 'afternoon', '종이책 소비 트렌드', array['소비트렌드','종이책'], '카카오톡 내보내기'),
  ('2026-06-08', 'afternoon', '혁신바우처 플랫폼 활용법', array['혁신바우처','기업지원'], '카카오톡 내보내기'),
  ('2026-06-09', 'afternoon', 'Gamma·Vrew 비주얼 AI 활용', array['Gamma','Vrew','AI','디자인'], '카카오톡 내보내기'),
  ('2026-06-10', 'afternoon', '고객을 붙잡는 3초 카피라이팅', array['카피라이팅','마케팅'], '카카오톡 내보내기'),
  ('2026-06-12', 'afternoon', 'CapCut 영상 편집 활용법', array['CapCut','영상','콘텐츠'], '카카오톡 내보내기'),
  ('2026-06-16', 'afternoon', 'Clova Note·VITO 음성 AI 활용', array['클로바노트','VITO','회의록','AI'], '카카오톡 내보내기'),
  ('2026-06-17', 'afternoon', '무료 언론홍보와 보도자료 작성', array['언론홍보','보도자료'], '카카오톡 내보내기'),
  ('2026-06-19', 'afternoon', '인바운드 마케팅과 브랜드 스토리', array['인바운드마케팅','스토리텔링'], '카카오톡 내보내기'),
  ('2026-06-22', 'afternoon', '정부24 미환급금 조회', array['정부24','미환급금','세금'], '카카오톡 내보내기'),
  ('2026-06-23', 'afternoon', 'AI를 활용한 계약서 위험 검토', array['계약서','법률','AI'], '카카오톡 내보내기'),
  ('2026-06-24', 'afternoon', '구매를 유도하는 심리 마케팅', array['심리마케팅','구매전환'], '카카오톡 내보내기'),
  ('2026-06-25', 'afternoon', '4대보험과 두루누리 지원', array['4대보험','두루누리','노무'], '카카오톡 내보내기'),
  ('2026-06-26', 'afternoon', '사람을 보고 구매하는 소비 트렌드', array['퍼스널브랜드','소비트렌드'], '카카오톡 내보내기'),
  ('2026-06-29', 'afternoon', '대금 회수와 금융 실무', array['대금회수','금융','현금흐름'], '카카오톡 내보내기'),
  ('2026-06-30', 'afternoon', '텍스트 업무 AI 도구', array['AI','텍스트','업무자동화'], '카카오톡 내보내기'),
  ('2026-07-01', 'afternoon', '추가 광고비 없는 프리미엄 브랜딩', array['브랜딩','포지셔닝'], '카카오톡 내보내기'),
  ('2026-07-02', 'afternoon', '프리랜서 계약의 노무 위험', array['프리랜서','계약','노무'], '카카오톡 내보내기'),
  ('2026-07-06', 'afternoon', '행정업무 시간을 줄이는 도구', array['행정','업무자동화'], '카카오톡 내보내기'),
  ('2026-07-07', 'afternoon', '초보자를 위한 AI 데이터 분석', array['AI','데이터분석'], '카카오톡 내보내기'),
  ('2026-07-08', 'afternoon', '공간·상품 배치와 고객 시선 설계', array['공간마케팅','상품배치','고객동선'], '카카오톡 내보내기'),
  ('2026-05-18', 'reference_material', '업종별 정부지원사업 설계 가이드', array['지원사업','업종별전략'], '카카오톡 내보내기'),
  ('2026-05-26', 'reference_material', 'AI로 사업계획서 품질 높이기', array['AI','사업계획서'], '카카오톡 내보내기'),
  ('2026-06-04', 'reference_material', '공고문에서 반드시 확인할 10가지', array['공고문','체크리스트'], '카카오톡 내보내기'),
  ('2026-06-11', 'reference_material', '사업계획서에서 평가자가 보는 5가지', array['사업계획서','평가'], '카카오톡 내보내기'),
  ('2026-06-18', 'reference_material', '평가자가 읽다가 멈추는 사업계획서 문장', array['사업계획서','문장'], '카카오톡 내보내기')
on conflict (published_on, title) do nothing;
