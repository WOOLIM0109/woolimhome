-- 이름을 못 붙여 `unknown-bot` 한 덩어리로 쌓인 봇 방문에 이름을 붙인다. 2026-11-24.
--
-- 2026-11-24에 `/api/admin/bot-traffic` 으로 30일 기록 4,410건의 user-agent 를
-- 전수로 읽었다. `unknown-bot` 314건이 실제로는 서로 다른 14종이었다.
-- 지금 코드는 lib/bot-detection.ts 에서 이 이름들을 잡지만, **이미 쌓인 기록은
-- 그대로 unknown-bot 이다.** 관리자 화면이 과거 추이를 보여 주는 곳이므로
-- 지난 기록도 같이 맞춘다.
--
-- 분류는 봇이 자기 user-agent 와 그 안의 주소에서 **스스로 밝힌 것만** 따랐다.
-- 용도를 확인할 수 없는 셋(ShapBot·webXtrendBot·wpbot)은 이름만 붙이고
-- bot_category 는 'unknown' 으로 남긴다. 모르는 것을 'ai' 로 올리면
-- 「AI가 우리를 읽었다」는 숫자가 부풀어 판단을 망친다.
--
-- 건수·마지막 시각은 2026-11-24 측정값(최근 30일)이다. 기간 제한 없이 돌리므로
-- 30일보다 오래된 행도 함께 바뀐다 — 실제 대상 건수는 아래 숫자보다 많을 수 있다.
-- bot_name·bot_category·bot_operator 세 칸만 바꾸고 user_agent 는 손대지 않는다.
--
-- 가장 큰 덩어리인 HeadlessChrome 2,988건은 **손대지 않는다.** 아직 누구인지
-- 모른다. 배포가 많은 날과 겹치지만 어긋나는 날(10-31 배포 10회·방문 0건,
-- 11-07 배포 0회·방문 361건)이 있어 배포 때문이라고 말할 수 없고, 이 저장소에는
-- headless 브라우저를 쓰는 코드가 없다. 추측으로 자사라고 적지 않는다.
-- 이미 'Automated tool'/'tool' 로 분류돼 있어 AI·검색 숫자를 오염시키지는 않는다.

BEGIN;

-- ExaSearchBot 117건 / 마지막 2026-11-23. crawler.exa.ai — Exa 는 AI 검색 서비스.
UPDATE public.bot_traffic_logs
SET bot_name = 'ExaSearchBot', bot_category = 'ai', bot_operator = 'Exa'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%ExaSearchBot%';

-- ExaUser 26건 / 마지막 2026-11-23.
UPDATE public.bot_traffic_logs
SET bot_name = 'ExaUser', bot_category = 'ai', bot_operator = 'Exa'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%ExaUser%';

-- Reflectionbot 5건 / 마지막 2026-10-26. reflection.ai/bot.
UPDATE public.bot_traffic_logs
SET bot_name = 'Reflectionbot', bot_category = 'ai', bot_operator = 'Reflection AI'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%Reflectionbot%';

-- SERankingBacklinksBot 59건 / 마지막 2026-11-11. 백링크 수집.
UPDATE public.bot_traffic_logs
SET bot_name = 'SERankingBacklinksBot', bot_category = 'seo', bot_operator = 'SE Ranking'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%SERankingBacklinksBot%';

-- meta-webindexer 37건 / 마지막 2026-11-21. 기존 'Meta AI'(meta-externalagent) 와 다른 봇이다.
-- 색인·공유 미리보기 쪽이라 'ai' 가 아닌 'search'. 로닛도 2026-11-23에 같은 이유로 인용 집계에서 뺐다.
UPDATE public.bot_traffic_logs
SET bot_name = 'meta-webindexer', bot_category = 'search', bot_operator = 'Meta'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%meta-webindexer%';

-- PetalBot 15건 / 마지막 2026-10-28. webmaster.petalsearch.com — 화웨이 Petal 검색.
UPDATE public.bot_traffic_logs
SET bot_name = 'PetalBot', bot_category = 'search', bot_operator = 'Huawei'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%PetalBot%';

-- KakaoBot 2건 / 마지막 2026-11-07. 기존 'kakaotalk-scrap' 과 다른 봇이다.
UPDATE public.bot_traffic_logs
SET bot_name = 'KakaoBot', bot_category = 'search', bot_operator = 'Kakao'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%KakaoBot%';

-- RecordedFuture 3건 / 마지막 2026-11-13. 자산 목록 조사.
UPDATE public.bot_traffic_logs
SET bot_name = 'RecordedFuture Crawler', bot_category = 'monitoring', bot_operator = 'Recorded Future'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%RecordedFuture%';

-- AgentTrustBot 5건 / 마지막 2026-10-30. user-agent 에 "purpose=AI agent directory" 라고 적고 온다.
UPDATE public.bot_traffic_logs
SET bot_name = 'AgentTrustBot', bot_category = 'tool', bot_operator = 'agenttru.st'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%AgentTrustBot%';

-- domains-crawler 2건 / 마지막 2026-11-11. user-agent 에 "ads.txt survey" 라고 적고 온다.
UPDATE public.bot_traffic_logs
SET bot_name = 'domains-crawler', bot_category = 'tool', bot_operator = '미확인(ads.txt 조사)'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%domains-crawler%';

-- OpenX-BusinessContactFinder 1건 / 마지막 2026-11-23. 업체 연락처 수집.
UPDATE public.bot_traffic_logs
SET bot_name = 'OpenX-BusinessContactFinder', bot_category = 'tool', bot_operator = '미확인(연락처 수집)'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%OpenX-BusinessContactFinder%';

-- 아래 셋은 이름만 확인했고 용도를 밝히지 않았다. bot_category 는 'unknown' 그대로 둔다.
-- ShapBot 26건 / IP 8개 / 마지막 2026-11-18.
UPDATE public.bot_traffic_logs
SET bot_name = 'ShapBot'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%ShapBot%';

-- webXtrendBot 3건 / 마지막 2026-11-20.
UPDATE public.bot_traffic_logs
SET bot_name = 'webXtrendBot'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%webXtrendBot%';

-- wpbot 2건 / 마지막 2026-11-13. 안내 주소가 구글 폼이다.
UPDATE public.bot_traffic_logs
SET bot_name = 'wpbot'
WHERE bot_name = 'unknown-bot' AND user_agent ILIKE '%wpbot/%';

COMMIT;
