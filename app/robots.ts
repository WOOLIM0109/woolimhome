import type { MetadataRoute } from "next";
import { toAbsoluteUrl } from "@/lib/site-config";

/**
 * 이름을 지정한 user-agent 그룹은 `User-agent: *` 그룹과 합쳐지지 않습니다.
 * 봇은 자기 이름이 적힌 그룹만 따르므로, 아래 그룹에도 `/admin/`·`/api/admin/`
 * 차단을 그대로 적어 두어야 합니다. 빼면 이름이 적힌 봇들은 관리자 경로를
 * 긁어도 규칙을 어긴 것이 아니게 됩니다.
 *
 * 크롤러 이름은 바뀝니다. `anthropic-ai`·`Claude-Web`은 폐기된 이름이라
 * 지웠습니다. 최신 검토 2026-11-05.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/llms.txt"],
        disallow: ["/admin/", "/api/admin/"],
        crawlDelay: 1,
      },
      {
        userAgent: [
          // OpenAI — OAI-SearchBot은 ChatGPT 검색 노출을 담당하므로 허용해야 합니다
          "OAI-SearchBot",
          "GPTBot",
          "ChatGPT-User",
          // Anthropic 현행 이름 — Claude-SearchBot을 막으면 검색 노출이 줄 수 있습니다
          "Claude-SearchBot",
          "Claude-User",
          "ClaudeBot",
          // Google — 학습·그라운딩 제어 토큰이고 검색 색인·순위와는 무관합니다
          "Google-Extended",
          "PerplexityBot",
          // Applebot-Extended는 크롤러가 아니라 학습 사용 여부만 가르는 제어 토큰입니다
          "Applebot-Extended",
          "Applebot",
          "meta-externalagent",
          "CCBot",
          "Amazonbot",
          "cohere-ai",
        ],
        allow: ["/", "/llms.txt"],
        disallow: ["/admin/", "/api/admin/"],
      },
    ],
    sitemap: toAbsoluteUrl("/sitemap.xml"),
  };
}
