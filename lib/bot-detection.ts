export type BotCategory =
  | "ai"
  | "search"
  | "social"
  | "seo"
  | "monitoring"
  | "archive"
  | "tool"
  | "unknown";

export interface BotPattern {
  pattern: RegExp;
  name: string;
  category: BotCategory;
  operator?: string;
}

export const BOT_PATTERNS: BotPattern[] = [
  { pattern: /OAI-SearchBot/i, name: "OAI-SearchBot", category: "ai", operator: "OpenAI" },
  { pattern: /ChatGPT-User/i, name: "ChatGPT-User", category: "ai", operator: "OpenAI" },
  { pattern: /GPTBot/i, name: "GPTBot", category: "ai", operator: "OpenAI" },
  { pattern: /Claude-SearchBot/i, name: "Claude-SearchBot", category: "ai", operator: "Anthropic" },
  { pattern: /Claude-User/i, name: "Claude-User", category: "ai", operator: "Anthropic" },
  { pattern: /ClaudeBot|Claude-Web|anthropic-ai/i, name: "ClaudeBot", category: "ai", operator: "Anthropic" },
  { pattern: /Google-Extended|GoogleOther/i, name: "Google-Extended", category: "ai", operator: "Google" },
  { pattern: /Perplexity-User/i, name: "Perplexity-User", category: "ai", operator: "Perplexity" },
  { pattern: /PerplexityBot/i, name: "PerplexityBot", category: "ai", operator: "Perplexity" },
  { pattern: /Applebot-Extended/i, name: "Applebot-Extended", category: "ai", operator: "Apple" },
  { pattern: /CCBot/i, name: "CCBot", category: "ai", operator: "Common Crawl" },
  { pattern: /Amazonbot/i, name: "Amazonbot", category: "ai", operator: "Amazon" },
  { pattern: /Bytespider/i, name: "Bytespider", category: "ai", operator: "ByteDance" },
  { pattern: /meta-externalagent|Meta-ExternalFetcher|FacebookBot/i, name: "Meta AI", category: "ai", operator: "Meta" },
  { pattern: /cohere-ai|cohere-training-data-crawler/i, name: "cohere-ai", category: "ai", operator: "Cohere" },
  { pattern: /MistralAI-User/i, name: "MistralAI-User", category: "ai", operator: "Mistral" },
  { pattern: /DeepSeek/i, name: "DeepSeekBot", category: "ai", operator: "DeepSeek" },
  { pattern: /YouBot/i, name: "YouBot", category: "ai", operator: "You.com" },
  { pattern: /DuckAssistBot/i, name: "DuckAssistBot", category: "ai", operator: "DuckDuckGo" },
  { pattern: /Yeti/i, name: "Yeti", category: "search", operator: "Naver" },
  { pattern: /Daumoa/i, name: "Daumoa", category: "search", operator: "Daum/Kakao" },
  { pattern: /Googlebot-Image/i, name: "Googlebot-Image", category: "search", operator: "Google" },
  { pattern: /Googlebot-News/i, name: "Googlebot-News", category: "search", operator: "Google" },
  { pattern: /Googlebot-Video/i, name: "Googlebot-Video", category: "search", operator: "Google" },
  { pattern: /Googlebot|Google-InspectionTool|AdsBot-Google/i, name: "Googlebot", category: "search", operator: "Google" },
  { pattern: /bingbot|BingPreview|adidxbot/i, name: "bingbot", category: "search", operator: "Microsoft" },
  { pattern: /YandexBot|YandexImages/i, name: "YandexBot", category: "search", operator: "Yandex" },
  { pattern: /Baiduspider/i, name: "Baiduspider", category: "search", operator: "Baidu" },
  { pattern: /DuckDuckBot|DuckDuckGo-Favicons-Bot/i, name: "DuckDuckBot", category: "search", operator: "DuckDuckGo" },
  { pattern: /Applebot/i, name: "Applebot", category: "search", operator: "Apple" },
  { pattern: /kakaotalk-scrap/i, name: "kakaotalk-scrap", category: "social", operator: "Kakao" },
  { pattern: /facebookexternalhit|Facebot/i, name: "Facebook preview", category: "social", operator: "Meta" },
  { pattern: /Twitterbot/i, name: "Twitterbot", category: "social", operator: "X" },
  { pattern: /LinkedInBot/i, name: "LinkedInBot", category: "social", operator: "LinkedIn" },
  { pattern: /Slackbot|Discordbot|TelegramBot|WhatsApp/i, name: "Messenger preview", category: "social", operator: "Messenger" },
  /**
   * 아래는 2026-11-24에 운영 기록(30일 4,410건)의 user-agent 를 전수로 읽어 이름을
   * 붙인 것들입니다. 그 전에는 전부 `unknown-bot` 한 덩어리(314건)로 쌓여, 누가
   * 오는지 볼 수 없었습니다.
   *
   * 분류는 **봇이 자기 user-agent 와 그 안의 주소에서 스스로 밝힌 것만** 따랐습니다.
   * 용도를 확인할 수 없는 것은 이름만 붙이고 `unknown` 으로 남겨 둡니다. 모르는 것을
   * ai 로 올리면 「AI가 우리를 읽었다」는 숫자가 부풀기 때문입니다.
   */
  // ExaSearchBot 117건 / ExaUser 26건, 마지막 2026-11-23. crawler.exa.ai — Exa 는 AI 검색 서비스.
  { pattern: /ExaSearchBot/i, name: "ExaSearchBot", category: "ai", operator: "Exa" },
  { pattern: /ExaUser/i, name: "ExaUser", category: "ai", operator: "Exa" },
  // 5건, 마지막 2026-10-26. reflection.ai/bot. 로닛도 같은 봇을 Reflection AI 로 분류했습니다.
  { pattern: /Reflectionbot/i, name: "Reflectionbot", category: "ai", operator: "Reflection AI" },
  // 59건, 마지막 2026-11-11. seranking.com/backlinks-crawler — 백링크 수집.
  { pattern: /SERankingBacklinksBot/i, name: "SERankingBacklinksBot", category: "seo", operator: "SE Ranking" },
  /**
   * 37건, 마지막 2026-11-21. 이름은 "webindexer" 이고 스스로 밝힌 주소는 Meta 의
   * 공유 크롤러 문서입니다. 생성형 AI 노출용이 아니라 색인·공유 미리보기 쪽이라
   * `ai` 가 아닌 `search` 로 둡니다. 로닛도 2026-11-23에 같은 이유로 이 봇을
   * 인용 집계에서 뺐습니다. 기존 "Meta AI"(meta-externalagent) 와 다른 봇입니다.
   */
  { pattern: /meta-webindexer/i, name: "meta-webindexer", category: "search", operator: "Meta" },
  // 15건, 마지막 2026-10-28. webmaster.petalsearch.com — 화웨이 Petal 검색.
  { pattern: /PetalBot/i, name: "PetalBot", category: "search", operator: "Huawei" },
  // 2건, 마지막 2026-11-07. cs.kakao.com 안내 문서를 달고 옵니다.
  { pattern: /KakaoBot/i, name: "KakaoBot", category: "search", operator: "Kakao" },
  // 3건, 마지막 2026-11-13. 자산 목록 조사(위협 인텔리전스 업체).
  { pattern: /RecordedFuture/i, name: "RecordedFuture Crawler", category: "monitoring", operator: "Recorded Future" },
  // 5건, 마지막 2026-10-30. user-agent 에 "purpose=AI agent directory" 라고 적고 옵니다.
  { pattern: /AgentTrustBot/i, name: "AgentTrustBot", category: "tool", operator: "agenttru.st" },
  // 2건, 마지막 2026-11-11. user-agent 에 "ads.txt survey" 라고 적고 옵니다.
  { pattern: /domains-crawler/i, name: "domains-crawler", category: "tool", operator: "미확인(ads.txt 조사)" },
  // 1건, 마지막 2026-11-23. 스스로 "BusinessContactFinder" — 업체 연락처 수집.
  { pattern: /OpenX-BusinessContactFinder/i, name: "OpenX-BusinessContactFinder", category: "tool", operator: "미확인(연락처 수집)" },
  /**
   * 아래 셋은 이름만 확인했고 용도를 밝히지 않았습니다. 그래서 `unknown` 그대로 둡니다.
   * 이름이 붙은 것만으로도 "기타 봇 한 덩어리"에서 떼어 낼 수 있습니다.
   */
  { pattern: /ShapBot/i, name: "ShapBot", category: "unknown" },           // 26건, IP 8개, 마지막 2026-11-18
  { pattern: /webXtrendBot/i, name: "webXtrendBot", category: "unknown" }, // 3건, 마지막 2026-11-20
  { pattern: /wpbot\//i, name: "wpbot", category: "unknown" },             // 2건, 마지막 2026-11-13. 안내 주소가 구글 폼
  { pattern: /AhrefsBot/i, name: "AhrefsBot", category: "seo", operator: "Ahrefs" },
  { pattern: /SemrushBot/i, name: "SemrushBot", category: "seo", operator: "Semrush" },
  { pattern: /MJ12bot|DotBot|BLEXBot|DataForSeoBot/i, name: "SEO crawler", category: "seo", operator: "SEO tool" },
  { pattern: /UptimeRobot|Pingdom|StatusCake|Site24x7/i, name: "Uptime monitor", category: "monitoring", operator: "Monitoring" },
  { pattern: /Chrome-Lighthouse|Lighthouse|WebPageTest|GTmetrix/i, name: "Performance monitor", category: "monitoring", operator: "Performance" },
  { pattern: /vercel-screenshot|vercel-favicon/i, name: "VercelBot", category: "monitoring", operator: "Vercel" },
  { pattern: /ia_archiver|archive\.org_bot/i, name: "Internet Archive", category: "archive", operator: "Internet Archive" },
  { pattern: /python-requests|Python-urllib|aiohttp/i, name: "python-http", category: "tool", operator: "Python" },
  { pattern: /Go-http-client/i, name: "Go-http-client", category: "tool", operator: "Go" },
  { pattern: /curl\/|Wget|Scrapy|HeadlessChrome/i, name: "Automated tool", category: "tool", operator: "Automation" },
];

const GENERIC_BOT_RE = /bot|crawler|spider|scraper|crawling/i;

export function detectBot(userAgent: string | null | undefined): BotPattern | null {
  if (!userAgent) return null;
  for (const entry of BOT_PATTERNS) {
    if (entry.pattern.test(userAgent)) return entry;
  }
  if (GENERIC_BOT_RE.test(userAgent)) {
    return { pattern: GENERIC_BOT_RE, name: "unknown-bot", category: "unknown" };
  }
  return null;
}

export const BOT_CATEGORY_LABEL: Record<BotCategory, string> = {
  ai: "AI/LLM",
  search: "검색엔진",
  social: "소셜 미리보기",
  seo: "SEO 도구",
  monitoring: "모니터링",
  archive: "아카이빙",
  tool: "자동화 도구",
  unknown: "기타 봇",
};
