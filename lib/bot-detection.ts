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
