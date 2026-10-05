import "server-only";
import { Resend } from "resend";
import { recordContactNotification, type ContactInquiry, type StoredInquiry } from "./store.ts";

const trackNames = { consulting: "경영컨설팅", "business-docs": "비즈니스문서·PPT", design: "디자인서비스", etc: "기타문의" } as const;

export function parseNotifyRecipients(value: string | undefined): string[] {
  const recipients = [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
  if (!recipients.length || recipients.some((item) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(item))) {
    throw new Error("CONTACT_NOTIFY_EMAILS is missing or invalid");
  }
  return recipients;
}

export function buildContactEmail(saved: StoredInquiry, inquiry: ContactInquiry, to: string[], from: string) {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(saved.created_at));
  const name = inquiry.name.replace(/[\r\n]+/g, " ");
  return {
    from, to,
    subject: `[상담신청] ${trackNames[inquiry.track]} · ${name} · ${date}`,
    text: [
      `접수번호: ${saved.id}`,
      `이름: ${inquiry.name}`, `연락처: ${inquiry.phone}`,
      `이메일: ${inquiry.email ?? "미입력"}`, `유입 화면: ${inquiry.source_path ?? "미확인"}`,
      "", "상담 세부 항목",
      ...Object.entries(inquiry.details).map(([key, value]) => `${key === "category" ? "상담 분야" : key}: ${value}`),
      "", "문의 내용", inquiry.message,
    ].join("\n"),
    ...(inquiry.email ? { replyTo: inquiry.email } : {}),
  };
}

type NotificationOptions = {
  env?: NodeJS.ProcessEnv;
  send?: (email: ReturnType<typeof buildContactEmail>, idempotencyKey: string, apiKey: string) => Promise<void>;
  record?: typeof recordContactNotification;
};

async function sendEmail(email: ReturnType<typeof buildContactEmail>, idempotencyKey: string, apiKey: string) {
  const resend = new Resend(apiKey);
  // 고정한 SDK 버전이 fetch에 전달하는 옵션이며 실제 요청 테스트로 검증합니다.
  const requestOptions = { idempotencyKey, signal: AbortSignal.timeout(10_000) };
  const result = await resend.emails.send(email, requestOptions);
  if (result.error || !result.data?.id) throw new Error("Resend delivery failed");
}

export async function notifyContactInquiry(saved: StoredInquiry, inquiry: ContactInquiry, options: NotificationOptions = {}) {
  const env = options.env ?? process.env;
  let notified_at: string | null = null;
  let notify_error: string | null = null;
  try {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is missing");
    const to = parseNotifyRecipients(env.CONTACT_NOTIFY_EMAILS);
    if (!env.RESEND_FROM || /[\r\n]/.test(env.RESEND_FROM)) throw new Error("RESEND_FROM is missing or invalid");
    const email = buildContactEmail(saved, inquiry, to, env.RESEND_FROM);
    try { await (options.send ?? sendEmail)(email, `contact/${saved.id}`, env.RESEND_API_KEY); }
    catch { throw new Error("Resend delivery failed"); }
    notified_at = new Date().toISOString();
  } catch (error) {
    // 상세 요청·본문·수신 주소를 로그 또는 오류 칼럼으로 복사하지 않습니다.
    notify_error = error instanceof Error ? error.message : "Contact notification failed";
    console.error("Contact notification failed", saved.id, notify_error);
  }
  await (options.record ?? recordContactNotification)(saved.id, { notified_at, notify_error });
}
