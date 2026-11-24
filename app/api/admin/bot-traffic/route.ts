import { NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { BOT_CATEGORY_LABEL, type BotCategory } from "@/lib/bot-detection";
import { attributeBotPath } from "@/lib/bot-path-attribution";
import { isCitationBot } from "@/lib/citation-bots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const PAGE_SIZE = 1_000;
/**
 * `user_agent` 가 빠져 있던 탓에, 관리자 화면에서 `unknown-bot`·「자동화 도구」의
 * 정체를 볼 방법이 없었습니다. 표에는 처음부터 저장돼 있었습니다.
 * 2026-11-24 실측으로 30일 4,371건 중 3,263건(74.7%)이 이 둘이었습니다.
 */
const COLUMNS = "bot_name,bot_category,bot_operator,page_kind,entity_slug,user_agent,requested_path,ip_address,country,accessed_at";

/** 정체를 아직 모르는 분류 둘. 이 둘만 user-agent 별로 따로 세어 보여 줍니다. */
const UNIDENTIFIED_CATEGORIES = new Set<BotCategory>(["unknown", "tool"]);
const UNIDENTIFIED_LIMIT = 25;

/**
 * `?exclude=tool,unknown` 으로 특정 분류를 통계에서 뺄 수 있게 합니다.
 *
 * 왜 필요한가 — 2026-11-24 기준 30일 방문 4,410건 가운데 2,988건(67.8%)이
 * 자기 이름을 밝히지 않는 HeadlessChrome 한 종입니다. AI·검색 건수는 분류가
 * 나뉘어 있어 괜찮지만, 경로·페이지 종류·국가·일자 추이는 전부 이 한 종에
 * 덮입니다. 「어느 페이지가 실제로 읽히는가」를 보려면 빼고 볼 수 있어야 합니다.
 *
 * 지우는 것이 아니라 보기에서만 빼는 것입니다. 그 방문이 누구인지 아직
 * 모르므로, 기록은 그대로 둡니다.
 */
function parseExcluded(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
}

interface LogRow {
  bot_name: string;
  bot_category: BotCategory | null;
  bot_operator: string | null;
  page_kind: string | null;
  entity_slug: string | null;
  user_agent: string | null;
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
  const excluded = parseExcluded(request.nextUrl.searchParams.get("exclude"));
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
  const unidentified = new Map<string, { agent: string; botName: string; count: number; ips: Set<string>; lastSeen: string }>();
  const byCitationBot = new Map<string, number>();
  let aiHits = 0;
  let searchHits = 0;
  /**
   * 실시간 인출(=인용)만 따로 셉니다. `aiHits` 는 학습 크롤러까지 포함한 수라
   * 「AI가 우리를 답에 썼나」를 보려면 쓸 수 없습니다. 기준은 lib/citation-bots.ts.
   */
  let citationHits = 0;

  const kept: LogRow[] = [];
  for (const log of logs) {
    if (excluded.size && excluded.has(log.bot_category || "unknown")) continue;
    kept.push(log);
    increment(byCategory, log.bot_category ? BOT_CATEGORY_LABEL[log.bot_category] : null);
    increment(byBot, log.bot_name);
    increment(byOperator, log.bot_operator);
    // 저장된 `page_kind` 가 아니라 경로에서 다시 뽑습니다. 분류 규칙이 옛 주소
    // 기준이던 동안 쌓인 기록까지 제 종류로 보이게 하려는 것입니다.
    increment(byPageKind, attributeBotPath(log.requested_path).pageKind);
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
    if (isCitationBot(log.bot_name)) {
      citationHits += 1;
      increment(byCitationBot, log.bot_name);
    }
    if (log.bot_category && UNIDENTIFIED_CATEGORIES.has(log.bot_category)) {
      const agent = (log.user_agent || "").trim() || "(user-agent 없음)";
      const entry = unidentified.get(agent)
        || { agent, botName: log.bot_name, count: 0, ips: new Set<string>(), lastSeen: log.accessed_at };
      entry.count += 1;
      if (log.ip_address) entry.ips.add(log.ip_address);
      if (log.accessed_at > entry.lastSeen) entry.lastSeen = log.accessed_at;
      unidentified.set(agent, entry);
    }
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
    // 분류를 빼고 볼 때는 남은 건수를 total 로 내려 화면 숫자가 서로 어긋나지
    // 않게 합니다. 전체 건수는 totalAll 로 함께 보냅니다.
    total: excluded.size ? kept.length : total,
    totalAll: total,
    excluded: [...excluded],
    sampled: kept.length,
    truncated: total > logs.length,
    aiHits,
    searchHits,
    citationHits,
    byCitationBot: rowsFrom(byCitationBot, 10),
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
    unidentifiedAgents: [...unidentified.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, UNIDENTIFIED_LIMIT)
      .map(({ agent, botName, count, ips, lastSeen }) => ({ agent, botName, count, ipCount: ips.size, lastSeen })),
    unidentifiedTotal: [...unidentified.values()].reduce((sum, entry) => sum + entry.count, 0),
    // 화면 표도 같은 규칙으로 보이도록 경로에서 다시 뽑은 종류를 실어 보냅니다.
    recent: kept.slice(0, 200).map((log) => ({
      ...log,
      page_kind: attributeBotPath(log.requested_path).pageKind,
    })),
  });
}
