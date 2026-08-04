import { createHash } from "node:crypto";

export function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function kstWeekday(date = new Date()) {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(date);
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[short as "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"];
}

export function normalizeText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function programFingerprint(title: string, url: string, externalId?: string | null) {
  const canonical = externalId || `${normalizeText(title).toLowerCase()}|${url.split("#")[0]}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export function programTitleKey(title: string) {
  return normalizeText(title)
    .toLowerCase()
    .replace(/^\s*[\[【(][^\]】)]*(부산|울산|경남|전국)[^\]】)]*[\]】)]\s*/i, "")
    .replace(/\b(참여기업|지원기업|참가기업|입주기업)\b/g, "기업")
    .replace(/\s*(추가\s*)?(재)?공고\s*$/g, "")
    .replace(/[^0-9a-z가-힣]+/g, "");
}
