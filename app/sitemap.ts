import type { MetadataRoute } from "next";
import { navFlatLinks } from "@/lib/schema";
import { toAbsoluteUrl } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const links = navFlatLinks();
  const unique = Array.from(new Map(links.map((link) => [link.href, link])).values());

  return [
    {
      url: toAbsoluteUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...unique.map((link) => ({
      url: toAbsoluteUrl(link.href),
      lastModified: now,
      changeFrequency: link.href.includes("news") || link.href.includes("columns") ? "weekly" as const : "monthly" as const,
      priority: link.href === "/contact" ? 0.9 : 0.75,
    })),
  ];
}

