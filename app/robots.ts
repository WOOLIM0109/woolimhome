import type { MetadataRoute } from "next";
import { toAbsoluteUrl } from "@/lib/site-config";

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
          "CCBot",
          "ChatGPT-User",
          "GPTBot",
          "Google-Extended",
          "anthropic-ai",
          "Claude-Web",
          "PerplexityBot",
          "Amazonbot",
          "cohere-ai",
        ],
        allow: "/",
      },
    ],
    sitemap: toAbsoluteUrl("/sitemap.xml"),
  };
}

