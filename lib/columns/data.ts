import { createClient } from "@supabase/supabase-js";
import type { ColumnPost } from "./types";
import { sanitizeGeneratedHtml } from "@/lib/security/html";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getPublishedColumns(): Promise<ColumnPost[]> {
  const supabase = publicClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("column_posts")
    .select("*")
    .eq("published", true)
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false });

  if (error) {
    console.error("Failed to load columns", error);
    return [];
  }
  return data as ColumnPost[];
}

export async function getPublishedColumn(slug: string): Promise<ColumnPost | null> {
  const supabase = publicClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("column_posts")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .lte("published_at", new Date().toISOString())
    .maybeSingle();

  if (error) return null;
  return data as ColumnPost | null;
}

export function safeArticleHtml(html: string) {
  return sanitizeGeneratedHtml(html);
}

export function metadataArray<T>(post: ColumnPost, key: string): T[] {
  const value = post.generation_metadata?.[key];
  return Array.isArray(value) ? value as T[] : [];
}
