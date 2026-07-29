import { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { BOT_CATEGORY_LABEL, type BotCategory } from "@/lib/bot-detection";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const PAGE_SIZE = 1_000;
const COLUMNS = "bot_name,bot_category,bot_operator,page_kind,entity_slug,requested_path,ip_address,country,accessed_at";

interface LogRow {
  bot_name: string;
  bot_category: BotCategory | null;
  bot_operator: string | null;
  page_kind: string | null;
  entity_slug: string | null;
  requested_path: string;
  ip_address: string | null;
  country: string | null;
  accessed_at: string;
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email);
}

function parsedIso(value: string | null, fallback: Date) {
  if (!value) return fallback.toISOString();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback.toISOString() : new Date(timestamp).toISOString();
}

function increment(map: Map<string, number>, key: string | null | undefined) {
  const normalized = key || "알 수 없음";
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function rowsFrom(map: Map<string, number>, limit = 30) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function kstDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const to = parsedIso(request.nextUrl.searchParams.get("to"), now);
  const from = parsedIso(
    request.nextUrl.searchParams.get("from"),
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  );
  const admin = createAdminClient();

  const countResult = await admin
    .from("bot_traffic_logs")
    .select("id", { count: "exact", head: true })
    .gte("accessed_at", from)
    .lte("accessed_at", to);

  if (countResult.error) {
    const missing = countResult.error.message.includes("bot_traffic_logs");
    return Response.json(
      { error: missing ? "봇 트래픽 데이터베이스가 아직 준비되지 않았습니다." : countResult.error.message },
      { status: missing ? 503 : 500 },
    );
  }

  const total = countResult.count || 0;
  const pageCount = Math.min(Math.ceil(total / PAGE_SIZE), MAX_ROWS / PAGE_SIZE);
  const pageResults = await Promise.all(
    Array.from({ length: pageCount }, (_, page) => admin
      .from("bot_traffic_logs")
      .select(COLUMNS)
      .gte("accessed_at", from)
      .lte("accessed_at", to)
      .order("accessed_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)),
  );
  const queryError = pageResults.find((result) => result.error)?.error;
  if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

  const logs = pageResults.flatMap((result) => (result.data || []) as LogRow[]);
  const byCategory = new Map<string, number>();
  const byBot = new Map<string, number>();
  const byOperator = new Map<string, number>();
  const byPageKind = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byDay = new Map<string, number>();
  const byDayBot = new Map<string, Map<string, number>>();
  const byDowHour = new Map<string, number>();
  let aiHits = 0;
  let searchHits = 0;

  for (const log of logs) {
    increment(byCategory, log.bot_category ? BOT_CATEGORY_LABEL[log.bot_category] : null);
    increment(byBot, log.bot_name);
    increment(byOperator, log.bot_operator);
    increment(byPageKind, log.page_kind);
    increment(byCountry, log.country);
    increment(byPath, log.requested_path);
    const day = kstDay(log.accessed_at);
    increment(byDay, day);
    if (!byDayBot.has(day)) byDayBot.set(day, new Map());
    increment(byDayBot.get(day)!, log.bot_name);
    const kst = new Date(new Date(log.accessed_at).getTime() + 9 * 60 * 60 * 1000);
    increment(byDowHour, `${kst.getUTCDay()}-${kst.getUTCHours()}`);
    if (log.bot_category === "ai") aiHits += 1;
    if (log.bot_category === "search") searchHits += 1;
  }

  const days = [...byDay.keys()].sort();
  const botTotals = rowsFrom(byBot, 12);
  const matrix = botTotals.map((bot) => ({
    name: bot.key,
    total: bot.count,
    perDay: days.map((day) => byDayBot.get(day)?.get(bot.key) || 0),
  }));

  return Response.json({
    window: { from, to },
    total,
    sampled: logs.length,
    truncated: total > logs.length,
    aiHits,
    searchHits,
    uniqueBots: byBot.size,
    byCategory: rowsFrom(byCategory),
    byBot: rowsFrom(byBot),
    byOperator: rowsFrom(byOperator, 12),
    byPageKind: rowsFrom(byPageKind),
    byCountry: rowsFrom(byCountry, 15),
    byPath: rowsFrom(byPath, 25),
    timeseries: days.map((day) => ({ day, total: byDay.get(day) || 0 })),
    matrix: { days, rows: matrix },
    dowHour: [...byDowHour.entries()].map(([key, count]) => {
      const [dow, hour] = key.split("-").map(Number);
      return { dow, hour, count };
    }),
    recent: logs.slice(0, 200),
  });
}
