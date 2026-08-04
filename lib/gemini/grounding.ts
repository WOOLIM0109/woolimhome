export type GeminiGroundingSource = {
  title: string;
  url: string;
};

type GeminiPayload = {
  candidates?: Array<{
    groundingMetadata?: {
      webSearchQueries?: unknown[];
      groundingChunks?: Array<{
        web?: { title?: unknown; uri?: unknown };
      }>;
    };
  }>;
};

export function extractGeminiGrounding(payload: unknown) {
  const candidate = (payload as GeminiPayload | null)?.candidates?.[0];
  const metadata = candidate?.groundingMetadata;
  const sources = (metadata?.groundingChunks || []).flatMap((chunk): GeminiGroundingSource[] => {
    const url = typeof chunk.web?.uri === "string" ? chunk.web.uri.trim() : "";
    if (!url) return [];
    const title = typeof chunk.web?.title === "string" && chunk.web.title.trim()
      ? chunk.web.title.trim()
      : url;
    return [{ title, url }];
  });
  const uniqueSources = [...sources.reduce((result, source) => {
    if (!result.has(source.url)) result.set(source.url, source);
    return result;
  }, new Map<string, GeminiGroundingSource>()).values()];
  const searchQueries = (metadata?.webSearchQueries || [])
    .filter((query): query is string => typeof query === "string" && Boolean(query.trim()))
    .map((query) => query.trim());
  return { groundingSources: uniqueSources, searchQueries: [...new Set(searchQueries)] };
}
