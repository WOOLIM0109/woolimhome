-- 울림컴퍼니 봇 트래픽 기록 테이블
-- Supabase SQL Editor에서 한 번 실행합니다.

CREATE TABLE IF NOT EXISTS public.bot_traffic_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_name TEXT NOT NULL,
  bot_category TEXT,
  bot_operator TEXT,
  page_kind TEXT,
  entity_slug TEXT,
  user_agent TEXT NOT NULL,
  requested_path TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_traffic_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages bot traffic logs" ON public.bot_traffic_logs;
CREATE POLICY "service role manages bot traffic logs"
  ON public.bot_traffic_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bot_traffic_accessed_at
  ON public.bot_traffic_logs (accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_traffic_bot_accessed_at
  ON public.bot_traffic_logs (bot_name, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_traffic_category_accessed_at
  ON public.bot_traffic_logs (bot_category, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_traffic_path
  ON public.bot_traffic_logs (requested_path);

COMMENT ON TABLE public.bot_traffic_logs IS
  '관리자와 API를 제외한 알려진 봇 요청 기록. IP는 애플리케이션에서 일부 마스킹해 저장한다.';
