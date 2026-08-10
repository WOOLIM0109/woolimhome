import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import { authenticatedPartner, contentAdmin } from "@/lib/content-ops/data";
import type { ContentChannel } from "@/lib/content-ops/types";

export const dynamic = "force-dynamic";

function koreaDateParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function selectedChannels(request: Request, adminUser: boolean) {
  const url = new URL(request.url);
  const values = [url.searchParams.get("channel"), ...(url.searchParams.get("channels") || "").split(",")]
    .filter(Boolean) as ContentChannel[];
  const valid = values.filter((value) => ["homepage", "naver_consulting", "naver_design"].includes(value));
  const requested = [...new Set(valid)];
  if (!adminUser) return requested.filter((value) => value !== "homepage");
  return requested;
}

export async function GET(request: Request) {
  const user = await authenticatedPartner();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const adminUser = isAdmin(user.email);
  const channels = selectedChannels(request, adminUser);
  if (!adminUser && !channels.length) {
    return NextResponse.json({ error: "조회할 수 있는 채널을 지정해 주세요." }, { status: 403 });
  }

  const today = koreaDateParts(new Date());
  const start = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 14);
  const selectedSlots = EDITORIAL_SLOTS.filter((slot) => !channels.length || channels.includes(slot.channel));
  const planned = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return selectedSlots
      .filter((slot) => slot.weekday === date.getUTCDay())
      .filter((slot) => slot.key !== "home-sat" || isoWeek(date) % 2 === 0)
      .map((slot) => {
        const dateKey = date.toISOString().slice(0, 10);
        return {
          ...slot,
          dateKey,
          scheduleKey: `${dateKey}-${slot.key}`,
          columnScheduleKey: `${dateKey}-${slot.weekday}`,
        };
      });
  }).flat();

  const admin = contentAdmin();
  let workQuery = admin.from("content_work_items")
    .select("id,schedule_key,channel,format,title,status,scheduled_at,retry_count,next_retry_at,last_error_code")
    .gte("scheduled_at", new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .lt("scheduled_at", end.toISOString());
  const channelFilter = channels.length ? channels : ["homepage", "naver_consulting", "naver_design"];
  workQuery = workQuery.in("channel", channelFilter);

  const [workResult, columnResult, automationResult] = await Promise.all([
    workQuery,
    channelFilter.includes("homepage")
      ? admin.from("column_generation_runs")
        .select("id,status,model,post_id,request_payload,retry_count,next_retry_at,last_error_code,error_message,created_at")
        .gte("created_at", new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .lt("created_at", end.toISOString())
      : Promise.resolve({ data: [], error: null }),
    admin.from("content_automation_runs")
      .select("id,cron_name,status,scheduled_for,completed_at")
      .in("cron_name", ["columns", "content-operations"])
      .order("scheduled_for", { ascending: false })
      .limit(12),
  ]);
  const error = workResult.error || columnResult.error || automationResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const workByKey = new Map((workResult.data || []).map((item) => [item.schedule_key, item]));
  const columnRuns = columnResult.data || [];
  const rows = planned.map((plan) => {
    const workItem = workByKey.get(plan.scheduleKey);
    const columnRun = plan.channel === "homepage"
      ? columnRuns.find((run) => run.request_payload?.scheduleKey === plan.columnScheduleKey && run.model === "scheduler-marker")
        || columnRuns.find((run) => run.request_payload?.scheduleKey === plan.columnScheduleKey)
      : null;
    const status = columnRun?.status === "generated"
      ? "review_required"
      : columnRun?.status === "failed"
        ? "on_hold"
        : columnRun?.status === "started"
          ? "creating"
          : workItem?.status || "planned";
    return {
      key: `${plan.scheduleKey}-${plan.channel}`,
      dateKey: plan.dateKey,
      hour: plan.hour,
      channel: plan.channel,
      format: plan.format,
      label: plan.label,
      status,
      title: columnRun?.post_id ? "홈페이지 칼럼 초안 생성됨" : workItem?.title || null,
      nextRetryAt: columnRun?.next_retry_at || workItem?.next_retry_at || null,
      retryCount: columnRun?.retry_count || workItem?.retry_count || 0,
      lastErrorCode: columnRun?.last_error_code || workItem?.last_error_code || null,
      errorMessage: columnRun?.error_message || null,
    };
  });

  return NextResponse.json({ rows, automationRuns: automationResult.data || [] }, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
