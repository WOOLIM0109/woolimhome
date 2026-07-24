"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";

type ScheduleItem = {
  key: string;
  date: string;
  type: string;
  status: "예정" | "건너뜀";
  description: string;
};

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function koreaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day))),
    hour: Number(value.hour),
  };
}

function upcomingSchedule(hasKnowledge: boolean): ScheduleItem[] {
  const now = koreaNow();
  const items: ScheduleItem[] = [];
  for (let offset = 0; offset < 25 && items.length < 7; offset += 1) {
    const date = new Date(now.date);
    date.setUTCDate(date.getUTCDate() + offset);
    const day = date.getUTCDay();
    if (![2, 4, 6].includes(day)) continue;
    if (offset === 0 && now.hour >= 10) continue;

    const label = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "UTC", month: "long", day: "numeric", weekday: "short",
    }).format(date);

    if (day === 6 && isoWeek(date) % 2 !== 0) {
      items.push({
        key: date.toISOString(), date: `${label} 오전 10시`, type: "격주 노하우형", status: "건너뜀",
        description: "격주 발행 일정에 따라 이번 토요일은 생성하지 않습니다.",
      });
    } else if (day === 2) {
      items.push({
        key: date.toISOString(), date: `${label} 오전 10시`, type: "정보형", status: "예정",
        description: "최신 공식자료를 조사해 기업 고객에게 필요한 정보형 초안을 만듭니다.",
      });
    } else if (day === 4) {
      items.push({
        key: date.toISOString(), date: `${label} 오전 10시`,
        type: hasKnowledge ? "하이브리드형" : "정보형 대체", status: "예정",
        description: hasKnowledge
          ? "공식자료와 승인된 울림 노하우를 결합한 초안을 만듭니다."
          : "승인 노하우가 부족해 공식자료 기반 정보형 초안으로 대체합니다.",
      });
    } else {
      items.push({
        key: date.toISOString(), date: `${label} 오전 10시`, type: "노하우형",
        status: hasKnowledge ? "예정" : "건너뜀",
        description: hasKnowledge
          ? "공식자료 조사와 승인된 원천자료를 결합한 노하우형 초안을 만듭니다."
          : "승인된 원천자료가 부족해 생성하지 않고 인터뷰 요청서를 준비합니다.",
      });
    }
  }
  return items;
}

export default function EditorialSchedule({ hasKnowledge }: { hasKnowledge: boolean }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => setItems(upcomingSchedule(hasKnowledge)), 0);
    return () => window.clearTimeout(timer);
  }, [hasKnowledge]);

  return (
    <section className="mt-8 overflow-hidden rounded-sm border border-[var(--line)] bg-white">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--surface-strong)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 shrink-0 text-[var(--primary)]" />
          <div>
            <h2 className="text-xl font-bold">앞으로 약 2주간 자동 생성 일정</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">날짜가 지나면 다음 일정이 자동으로 채워집니다.</p>
          </div>
        </div>
        <p className="inline-flex items-center gap-2 text-sm font-bold text-[#5f5750]">
          <Clock3 size={16} /> 모두 오전 10시 · 비공개 초안 저장
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="bg-[#fffaf7]">
              <th className="px-5 py-3">일정</th><th className="px-5 py-3">글 유형</th>
              <th className="px-5 py-3">상태</th><th className="px-5 py-3">생성 방식</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key} className="border-t border-[var(--line)]">
                <td className="whitespace-nowrap px-5 py-4 font-bold">{item.date}</td>
                <td className="whitespace-nowrap px-5 py-4">{item.type}</td>
                <td className="px-5 py-4">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                    item.status === "예정" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"
                  }`}>{item.status}</span>
                </td>
                <td className="px-5 py-4 leading-6 text-[var(--muted)]">{item.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
