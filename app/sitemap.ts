import type { MetadataRoute } from "next";
import { navFlatLinks } from "@/lib/schema";
import { toAbsoluteUrl } from "@/lib/site-config";
import { getPublishedColumns } from "@/lib/columns/data";
import { news } from "@/data/news";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const links = navFlatLinks();
  const unique = Array.from(new Map(links.map((link) => [link.href, link])).values());
  const columns = await getPublishedColumns();

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
    ...columns.map((post) => ({
      url: toAbsoluteUrl(`/columns/${post.slug}`),
      lastModified: new Date(post.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...news.filter((item) => item.slug).map((item) => ({
      url: toAbsoluteUrl(`/news/${item.slug}`),
      lastModified: new Date(item.date),
      changeFrequency: "yearly" as const,
      priority: 0.75,
    })),
  ];
}

