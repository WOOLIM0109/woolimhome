"use client";

import { useMemo } from "react";
import { CHANNELS, EDITORIAL_SLOTS } from "@/lib/content-ops/config";
import type { ContentChannel } from "@/lib/content-ops/types";

type TwoWeekScheduleProps = {
  channel?: ContentChannel;
  channels?: readonly ContentChannel[];
  statusHeading?: string;
  statusText?: string;
};

function startOfKoreaDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
}

function formatHour(hour: number) {
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}시`;
}

export default function TwoWeekSchedule({
  channel,
  channels,
  statusHeading = "발행 준비",
  statusText = "비공개 초안 생성 후 검토",
}: TwoWeekScheduleProps) {
  const rows = useMemo(() => {
    const start = startOfKoreaDay();
    return Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + offset);
      const slots = EDITORIAL_SLOTS.filter((slot) => slot.weekday === date.getUTCDay())
        .filter((slot) => !channel || slot.channel === channel)
        .filter((slot) => !channels || channels.includes(slot.channel));
      return slots.map((slot) => ({
        ...slot,
        date,
        dateLabel: new Intl.DateTimeFormat("ko-KR", {
          timeZone: "UTC",
          month: "long",
          day: "numeric",
          weekday: "short",
        }).format(date),
      }));
    }).flat();
  }, [channel, channels]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-[#fff3e9]">
          <tr>
            <th className="px-5 py-4">예정일</th>
            {!channel && <th className="px-5 py-4">채널</th>}
            <th className="px-5 py-4">콘텐츠</th>
            <th className="px-5 py-4">{statusHeading}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.key}-${row.date.toISOString()}`} className="border-t border-[var(--line)]">
              <td className="whitespace-nowrap px-5 py-4 font-bold">{row.dateLabel} {formatHour(row.hour)}</td>
              {!channel && (
                <td className="px-5 py-4">
                  {CHANNELS.find((item) => item.value === row.channel)?.shortLabel}
                </td>
              )}
              <td className="px-5 py-4">{row.label}</td>
              <td className="px-5 py-4 text-[var(--muted)]">{statusText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
