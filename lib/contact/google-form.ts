import "server-only";
import type { ContactInquiry } from "./store.ts";

// 전환 후 2주간 DB 접수와 병행합니다. 건수 대조 전에는 제거하지 않습니다.
const FORM_ID = "1FAIpQLSe2cyHSmPdAxFJJbn2-eMCAA-0por0b_D0DXJi_EvH6rCx9Bg";
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;
const FORM_ACTION = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;

const ENTRY = {
  name: "entry.1725469366",
  phone: "entry.1401280796",
  email: "entry.82188089",
  category: "entry.2078380745",
  message: "entry.1246105004",
} as const;

function readHiddenValue(html: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`name="${escapedName}"[^>]*value="([^"]*)"`),
    new RegExp(`value="([^"]*)"[^>]*name="${escapedName}"`),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  return "";
}

export async function submitGoogleForm(inquiry: ContactInquiry, fetcher: typeof fetch = fetch) {
  const formPage = await fetcher(FORM_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!formPage.ok) {
    throw new Error(`Google Form page request failed: ${formPage.status}`);
  }

  const formHtml = await formPage.text();
  const fbzx = readHiddenValue(formHtml, "fbzx");
  if (!fbzx) {
    throw new Error("Google Form submission token was not found.");
  }

  const formBody = new URLSearchParams({
    [ENTRY.name]: inquiry.name,
    [ENTRY.phone]: inquiry.phone,
    [ENTRY.email]: inquiry.email ?? "",
    [ENTRY.category]: inquiry.details.category,
    [ENTRY.message]: inquiry.message,
    fvv: "1",
    pageHistory: "0",
    fbzx,
    partialResponse: JSON.stringify([null, null, fbzx]),
    submissionTimestamp: "-1",
  });

  const formResponse = await fetcher(FORM_ACTION, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: formBody,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!formResponse.ok) {
    throw new Error(`Google Form submission failed: ${formResponse.status}`);
  }
}
