import { NextResponse } from "next/server";
import { createRateLimiter, requesterKey } from "@/lib/rate-limit";

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

/**
 * 한 곳에서 열 번을 넘기면 한 시간 동안 막습니다.
 *
 * 사람이 문의를 넣는 속도로는 닿기 어려운 수이고, 몰아치는 쪽은 바로 걸립니다.
 * 이 주소는 한 번 불릴 때마다 구글 폼으로 두 번 나가기 때문에, 제한이 없으면
 * 부르는 쪽이 우리 비용을 정하게 됩니다.
 */
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1_000 });

/**
 * 항목마다 길이를 정해 둡니다.
 *
 * 상한이 없으면 본문에 얼마든지 실어 보낼 수 있고, 그대로 바깥으로 나갑니다.
 */
const MAX_LENGTH = {
  name: 60,
  phone: 30,
  email: 120,
  category: 60,
  message: 2_000,
} as const;

type ContactPayload = {
  name?: string;
  phone?: string;
  email?: string;
  category?: string;
  message?: string;
  /** 사람에게는 보이지 않는 항목. 채워져 오면 사람이 아닙니다. */
  website?: string;
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

function tooLong(value: string, field: keyof typeof MAX_LENGTH) {
  return value.length > MAX_LENGTH[field];
}

export async function POST(request: Request) {
  const gate = limiter.check(requesterKey(request.headers));
  if (!gate.allowed) {
    return NextResponse.json(
      { ok: false, message: "문의가 너무 자주 접수되었습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    const payload = (await request.json()) as ContactPayload;

    // 사람에게 보이지 않는 항목이 채워졌으면 자동 도구입니다. 접수한 것처럼
    // 답하되 아무것도 보내지 않습니다. 막혔다고 알려 주면 우회를 시도합니다.
    if (payload.website?.trim()) return NextResponse.json({ ok: true });

    const name = payload.name?.trim();
    const phone = payload.phone?.trim();
    const email = payload.email?.trim() ?? "";
    const category = payload.category?.trim();
    const message = payload.message?.trim();

    if (!name || !phone || !category || !message) {
      return NextResponse.json({ ok: false, message: "필수 항목을 입력해 주세요." }, { status: 400 });
    }
    if (
      tooLong(name, "name") || tooLong(phone, "phone") || tooLong(email, "email")
      || tooLong(category, "category") || tooLong(message, "message")
    ) {
      return NextResponse.json(
        { ok: false, message: "입력이 너무 깁니다. 내용을 줄여 다시 시도해 주세요." },
        { status: 400 },
      );
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
