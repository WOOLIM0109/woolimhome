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

const DETAIL_PLACEHOLDER = /(원문|공고문|첨부파일).{0,14}(참조|확인|확인이 필요)|세부 지원 내용과 금액|신청 대상은 .*확인|지원 내용은 .*확인/i;
const GENERIC_DETAIL = /공고별 신청 요건을 충족|세부 지원 내용과 금액은|접수방법은 (원문 )?공고문|신청 대상은 공고문|지원 내용은 공고문/i;

function isOnlyPlaceholder(value: string) {
  if (GENERIC_DETAIL.test(value)) return true;
  if (!DETAIL_PLACEHOLDER.test(value)) return false;
  const meaningful = value
    .replace(/※?\s*(자세한|세부)?\s*(내용은?)?\s*(원문|공고문|첨부파일)[^.。\n]*(참조|확인)[^.。\n]*/gi, "")
    .trim();
  return meaningful.length < 12;
}

export function programDetailIssue(program: {
  applicantSummary?: string | null;
  supportSummary?: string | null;
  applicationMethod?: string | null;
  applicationPeriodText?: string | null;
  startsAt?: string | null;
  deadlineAt?: string | null;
}) {
  const applicant = normalizeText(program.applicantSummary || "");
  const support = normalizeText(program.supportSummary || "");
  const method = normalizeText(program.applicationMethod || "");
  const period = normalizeText(program.applicationPeriodText || "");
  if (applicant.length < 10 || isOnlyPlaceholder(applicant)) return "신청대상 누락";
  if (support.length < 12 || isOnlyPlaceholder(support)) return "지원내용·금액 누락";
  if (/(지원금|사업화\s*자금|바우처|보조금)/i.test(support) && !/(\d[\d,.]*\s*(원|만\s*원|억\s*원)|최대\s*\d|무상|무료)/i.test(support)) {
    return "지원금액 누락";
  }
  if (!period && !program.startsAt && !program.deadlineAt) return "신청기간 누락";
  if (period && isOnlyPlaceholder(period)) return "신청기간 누락";
  if (method.length < 4 || isOnlyPlaceholder(method)) return "접수방법 누락";
  return null;
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
