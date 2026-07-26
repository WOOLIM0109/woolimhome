alter table public.content_source_registry
  add column if not exists channels text[] not null default array['naver_consulting']::text[];

update public.content_source_registry
set channels = array['naver_consulting']::text[]
where channels is null or cardinality(channels) = 0;

insert into public.content_source_registry
  (name, base_url, source_grade, collection_method, topic_families, cadence, channels)
values
  ('Microsoft PowerPoint 지원', 'https://support.microsoft.com/powerpoint', 1, 'page',
    array['프레젠테이션', 'PPT', '문서 제작'], 'weekly', array['naver_design']),
  ('Adobe Design Discover', 'https://www.adobe.com/creativecloud/design/discover.html', 1, 'page',
    array['그래픽 디자인', '레이아웃', '브랜딩'], 'weekly', array['naver_design']),
  ('Material Design', 'https://m3.material.io/', 1, 'page',
    array['정보 구조', '레이아웃', '디자인 시스템'], 'weekly', array['naver_design']),
  ('W3C Web Accessibility Initiative', 'https://www.w3.org/WAI/standards-guidelines/wcag/', 1, 'page',
    array['가독성', '접근성', '정보 전달'], 'monthly', array['naver_design']),
  ('Nielsen Norman Group', 'https://www.nngroup.com/articles/', 2, 'page',
    array['사용성', '가독성', '정보 구조'], 'weekly', array['naver_design'])
on conflict (base_url) do update
set channels = excluded.channels,
    topic_families = excluded.topic_families,
    enabled = true,
    updated_at = now();
