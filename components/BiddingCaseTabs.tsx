"use client";

import { useMemo, useState } from "react";
import { Award, Gavel, Store } from "lucide-react";

type BiddingCase = {
  slug: string;
  company: string;
  title: string;
  result: string;
  challenge: string;
  approach: string;
};

type BiddingGroup = {
  slug: string;
  group: string;
  items: BiddingCase[];
};

type BiddingCaseTabsProps = {
  groups: BiddingGroup[];
};

const groupIcons = {
  "public-bidding": Gavel,
  "retail-partnership": Store,
  "awards-presentation": Award,
};

export default function BiddingCaseTabs({ groups }: BiddingCaseTabsProps) {
  const [activeGroup, setActiveGroup] = useState("all");
  const allCases = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.group, groupSlug: group.slug }))),
    [groups],
  );
  const visibleCases = activeGroup === "all"
    ? allCases
    : allCases.filter((item) => item.groupSlug === activeGroup);

  const tabs = [
    { slug: "all", label: "전체", count: allCases.length },
    ...groups.map((group) => ({ slug: group.slug, label: group.group, count: group.items.length })),
  ];

  return (
    <div>
      <div className="overflow-x-auto pb-2" role="tablist" aria-label="입찰·입점 성공사례 분류">
        <div className="flex w-max min-w-full gap-1 rounded-lg border border-[var(--line)] bg-[#f1ede8] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              role="tab"
              aria-selected={activeGroup === tab.slug}
              aria-controls={activeGroup === tab.slug ? "bidding-case-panel" : undefined}
              onClick={() => setActiveGroup(tab.slug)}
              className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-bold transition ${
                activeGroup === tab.slug
                  ? "bg-white text-[#241b15] shadow-[0_5px_16px_rgba(48,36,29,0.12)]"
                  : "text-[var(--muted)] hover:bg-white/70 hover:text-[#241b15]"
              }`}
            >
              {tab.label}
              <span className={`text-xs ${activeGroup === tab.slug ? "text-[var(--primary)]" : "text-[#9b8e84]"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-b border-[var(--line)] pb-4 text-sm">
        <p className="font-bold text-[#34281f]">{tabs.find((tab) => tab.slug === activeGroup)?.label} 성공사례</p>
        <p className="text-[var(--muted)]">{visibleCases.length}건</p>
      </div>

      <div id="bidding-case-panel" role="tabpanel" className="mt-6 grid gap-5 lg:grid-cols-2">
        {visibleCases.map((item) => {
          const Icon = groupIcons[item.groupSlug as keyof typeof groupIcons] || Gavel;
          return (
            <article
              id={`case-${item.slug}`}
              key={item.slug}
              className="scroll-mt-28 rounded-lg border border-[var(--line)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#edf5f1] text-[#24604f]">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#24604f]">{item.group}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[var(--muted)]">{item.company}</p>
                  </div>
                </div>
                <strong className="shrink-0 text-right text-xl font-black text-[var(--primary)]">{item.result}</strong>
              </div>

              <h3 className="mt-5 text-xl font-black leading-8 text-[#211811]">{item.title}</h3>
              <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                <div className="grid gap-1 py-4 sm:grid-cols-[82px_1fr] sm:gap-4">
                  <dt className="text-xs font-bold text-[var(--primary)]">기업 과제</dt>
                  <dd className="text-sm leading-6 text-[#4a3b31]">{item.challenge}</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[82px_1fr] sm:gap-4">
                  <dt className="text-xs font-bold text-[var(--primary)]">울림 수행</dt>
                  <dd className="text-sm leading-6 text-[#4a3b31]">{item.approach}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
