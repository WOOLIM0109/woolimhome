"use client";

import styles from "./PortfolioSuccess.module.css";

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
    <div className={styles.bidding}>
      <div className="overflow-x-auto pb-2" role="tablist" aria-label="입찰·입점 성공사례 분류">
        <div className={styles.filters}>
          {tabs.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              role="tab"
              aria-selected={activeGroup === tab.slug}
              aria-controls={activeGroup === tab.slug ? "bidding-case-panel" : undefined}
              onClick={() => setActiveGroup(tab.slug)}
              className={styles.filter}
            >
              {tab.label}
              <span className={`text-[14px] ${activeGroup === tab.slug ? "text-[#eb6826]" : "text-[#888888]"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-b border-[var(--line)] pb-4 text-base lg:text-[17px]">
        <p className="font-bold text-[#171717]">{tabs.find((tab) => tab.slug === activeGroup)?.label} 성공사례</p>
        <p className="text-[var(--muted)]">{visibleCases.length}건</p>
      </div>

      <div id="bidding-case-panel" role="tabpanel" className={styles.biddingGrid}>
        {visibleCases.map((item) => {
          const Icon = groupIcons[item.groupSlug as keyof typeof groupIcons] || Gavel;
          return (
            <article
              id={`case-${item.slug}`}
              key={item.slug}
              className={styles.biddingCase}
            >
              <div className={styles.biddingHeading}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={styles.caseIcon}>
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-[#eb6826]">{item.group}</p>
                    <p className="mt-1 text-base lg:text-[17px] font-medium leading-6 text-[var(--muted)]">{item.company}</p>
                  </div>
                </div>
                <strong className={styles.biddingResult}>{item.result}</strong>
              </div>

              <h3 className="mt-5 text-xl font-bold leading-8 text-[#171717]">{item.title}</h3>
              <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                <div className="grid gap-1 py-4 sm:grid-cols-[82px_1fr] sm:gap-4">
                  <dt className="text-[14px] font-bold text-[#eb6826]">기업 과제</dt>
                  <dd className="text-base lg:text-[17px] leading-6 text-[#555555]">{item.challenge}</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[82px_1fr] sm:gap-4">
                  <dt className="text-[14px] font-bold text-[#eb6826]">울림 수행</dt>
                  <dd className="text-base lg:text-[17px] leading-6 text-[#555555]">{item.approach}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}