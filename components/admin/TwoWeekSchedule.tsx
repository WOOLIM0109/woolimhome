"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANNELS, STATUS_LABELS, STATUS_STYLES } from "@/lib/content-ops/config";
import type { ContentChannel, WorkflowStatus } from "@/lib/content-ops/types";

type TwoWeekScheduleProps = {
  channel?: ContentChannel;
  channels?: readonly ContentChannel[];
  statusHeading?: string;
  statusText?: string;
};

type ScheduleRow = {
  key: string;
  dateKey: string;
  hour: number;
  channel: ContentChannel;
  format: string;
  label: string;
  status: WorkflowStatus | "planned";
  title: string | null;
  nextRetryAt: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  errorMessage: string | null;
};

type AutomationRun = {
  id: string;
  cron_name: string;
  status: string;
  scheduled_for: string;
  completed_at: string | null;
};

function formatHour(hour: number) {
  const period = hour < 12 ? "오전" : "오후";
  return `${period} ${hour % 12 || 12}시`;
}

export default function TwoWeekSchedule({
  channel,
  channels,
  statusHeading = "실제 상태",
  statusText = "아직 생성 전",
}: TwoWeekScheduleProps) {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (channel) params.set("channel", channel);
    if (channels?.length) params.set("channels", channels.join(","));
    return params.toString();
  }, [channel, channels]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const response = await fetch(`/api/schedule${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setError(data.error || "운영 일정을 불러오지 못했습니다.");
      else {
        setRows(data.rows || []);
        setAutomationRuns(data.automationRuns || []);
        setError("");
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [query]);

  if (loading) return <p className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--muted)]">DB 운영 일정을 불러오는 중입니다.</p>;
  if (error) return <p className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700" role="alert">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#fff3e9]">
            <tr>
              <th className="px-5 py-4">예정일</th>
              {!channel && <th className="px-5 py-4">채널</th>}
              <th className="px-5 py-4">콘텐츠</th>
              <th className="px-5 py-4">{statusHeading}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const statusLabel = row.status === "planned" ? statusText : STATUS_LABELS[row.status];
              const statusClass = row.status === "planned"
                ? "bg-stone-100 text-stone-700"
                : STATUS_STYLES[row.status];
              return (
                <tr key={row.key} className="border-t border-[var(--line)] align-top">
                  <td className="whitespace-nowrap px-5 py-4 font-bold">
                    {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${row.dateKey}T00:00:00Z`))} {formatHour(row.hour)}
                  </td>
                  {!channel && <td className="px-5 py-4">{CHANNELS.find((item) => item.value === row.channel)?.shortLabel}</td>}
                  <td className="px-5 py-4">
                    <span>{row.label}</span>
                    {row.title && <small className="mt-1 block text-[var(--muted)]">{row.title}</small>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span>
                    {row.nextRetryAt && (
                      <small className="mt-2 block text-red-700">
                        자동 재시도 {new Date(row.nextRetryAt).toLocaleString("ko-KR")} · {row.retryCount}회
                      </small>
                    )}
                    {row.lastErrorCode && <small className="mt-1 block text-[var(--muted)]">{row.lastErrorCode}</small>}
                    {row.errorMessage && <small className="mt-1 block max-w-md whitespace-pre-wrap text-red-700">{row.errorMessage}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {automationRuns.length > 0 && (
        <p className="rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-xs text-[var(--muted)]">
          최근 자동화: {automationRuns.slice(0, 4).map((run) => `${run.cron_name} ${run.status} (${new Date(run.scheduled_for).toLocaleString("ko-KR")})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
