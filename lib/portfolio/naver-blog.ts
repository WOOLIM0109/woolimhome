function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

export async function fetchExistingDesignBlogTitles() {
  try {
    const response = await fetch("https://rss.blog.naver.com/wl_0109.xml", {
      headers: {
        "User-Agent": "WoolimCompanyContentReview/1.0",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [] as string[];
    const xml = await response.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/gi)]
      .map((match) => decodeXml(match[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [] as string[];
  }
}
