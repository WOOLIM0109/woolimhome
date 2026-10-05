import { createHash } from "node:crypto";
import { createRateLimiter, requesterKey } from "../rate-limit.ts";
import type { ContactInquiry, StoredInquiry } from "./store.ts";

const limits = { name: 60, phone: 30, email: 120, category: 60, message: 2_000 } as const;
const consultingCategories = new Set(["정부지원사업", "정책자금", "기업인증 (벤처인증)", "기업인증 (이노비즈, 메인비즈)", "기업인증 (ISO)", "연구소 또는 연구개발전담부서 설립", "종합 경영컨설팅"]);
const documentCategories = new Set(["사업계획서 IR", "소개서, 제안서 등 PPT"]);
const categories = new Set([...consultingCategories, ...documentCategories, "디자인 서비스", "기타문의"]);

export function createContactHandler(dependencies: {
  store: (inquiry: ContactInquiry) => Promise<StoredInquiry>;
  deliver: (saved: StoredInquiry, inquiry: ContactInquiry) => Promise<void>;
  defer: (task: () => Promise<void>) => void;
  limiter?: ReturnType<typeof createRateLimiter>;
}) {
  const limiter = dependencies.limiter ?? createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1_000 });
  return async (request: Request): Promise<Response> => {
    let payload: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid payload");
      payload = value as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, message: "입력 형식을 확인해 주세요." }, { status: 400 });
    }
    // 허니팟은 속도 제한보다 먼저 처리하며 저장·외부 요청을 하지 않습니다.
    if (payload.website && (typeof payload.website !== "string" || payload.website.trim())) return Response.json({ ok: true });
    const key = createHash("sha256").update(requesterKey(request.headers)).digest("hex");
    const gate = limiter.check(key);
    if (!gate.allowed) return Response.json({ ok: false, message: "문의가 너무 자주 접수되었습니다. 잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } });

    const fields: Record<keyof typeof limits, string> = { name: "", phone: "", email: "", category: "", message: "" };
    for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
      const value = payload[field];
      if ((value !== undefined && typeof value !== "string") || (typeof value === "string" && value.length > limits[field])) return Response.json({ ok: false, message: "입력 항목과 길이를 확인해 주세요." }, { status: 400 });
      fields[field] = typeof value === "string" ? value.trim() : "";
    }
    if (!fields.name || !fields.phone || !fields.message || !categories.has(fields.category) || (fields.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email))) return Response.json({ ok: false, message: "필수 항목과 이메일 형식을 확인해 주세요." }, { status: 400 });
    let sourcePath: string | null = null;
    try {
      const source = new URL(request.headers.get("referer") ?? "");
      if (source.origin === new URL(request.url).origin) sourcePath = source.pathname.slice(0, 500);
    } catch { /* 유입 주소가 없거나 올바르지 않으면 저장하지 않습니다. */ }
    const inquiry: ContactInquiry = {
      track: consultingCategories.has(fields.category) ? "consulting" : documentCategories.has(fields.category) ? "business-docs" : fields.category === "디자인 서비스" ? "design" : "etc",
      name: fields.name, phone: fields.phone, email: fields.email || null, message: fields.message,
      details: { category: fields.category }, source_path: sourcePath, requester_key: key,
    };
    let saved: StoredInquiry;
    try { saved = await dependencies.store(inquiry); }
    catch {
      console.error("Contact inquiry database save failed");
      return Response.json({ ok: false, message: "문의 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
    }
    // 접수 완료는 저장으로 결정합니다. 응답 이후 메일과 구글폼을 병행합니다.
    try {
      dependencies.defer(async () => {
        try { await dependencies.deliver(saved, inquiry); }
        catch { console.error("Contact inquiry delivery failed", saved.id); }
      });
    } catch { console.error("Contact inquiry delivery scheduling failed", saved.id); }
    return Response.json({ ok: true });
  };
}
