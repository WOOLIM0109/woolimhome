import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

type ContactPayload = {
  name?: string;
  phone?: string;
  email?: string;
  category?: string;
  message?: string;
};

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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ContactPayload;
    const name = payload.name?.trim();
    const phone = payload.phone?.trim();
    const email = payload.email?.trim() ?? "";
    const category = payload.category?.trim();
    const message = payload.message?.trim();

    if (!name || !phone || !category || !message) {
      return NextResponse.json({ ok: false, message: "필수 항목을 입력해 주세요." }, { status: 400 });
    }

    const formPage = await fetch(FORM_URL, { cache: "no-store" });
    if (!formPage.ok) {
      throw new Error(`Google Form page request failed: ${formPage.status}`);
    }

    const formHtml = await formPage.text();
    const fbzx = readHiddenValue(formHtml, "fbzx");
    if (!fbzx) {
      throw new Error("Google Form submission token was not found.");
    }

    const formBody = new URLSearchParams({
      [ENTRY.name]: name,
      [ENTRY.phone]: phone,
      [ENTRY.email]: email,
      [ENTRY.category]: category,
      [ENTRY.message]: message,
      fvv: "1",
      pageHistory: "0",
      fbzx,
      partialResponse: JSON.stringify([null, null, fbzx]),
      submissionTimestamp: "-1",
    });

    const formResponse = await fetch(FORM_ACTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: formBody,
      redirect: "follow",
      cache: "no-store",
    });

    if (!formResponse.ok) {
      throw new Error(`Google Form submission failed: ${formResponse.status}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Contact form submission error", error);
    return NextResponse.json(
      { ok: false, message: "문의 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
