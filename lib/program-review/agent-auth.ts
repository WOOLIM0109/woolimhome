import { createHash, timingSafeEqual } from "node:crypto";

/** A separate credential used only by the explicitly exposed /api/agent routes. */
export function authorizeProgramAgent(request: Request, configured = process.env.PROGRAM_AGENT_TOKEN) {
  const value = request.headers.get("authorization");
  if (!configured || configured.length < 32 || !value || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(value)) return false;
  const supplied = value.slice(7);
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(configured).digest());
}

export const AGENT_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store", Vary: "Authorization", "X-Content-Type-Options": "nosniff",
};

export class ProgramApiError extends Error {
  // 생성자 인자에 바로 적지 않습니다. Node 가 타입만 떼어 내는 방식으로 읽을 때
  // 그 모양을 못 읽어서, 이 파일을 거쳐 가는 검사가 통째로 멈춥니다.
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function hasCredentialLikeValue(value: string) {
  const known = [process.env.PROGRAM_AGENT_TOKEN, process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.WOOLIMWORKS_AGENT_TOKEN, process.env.GEMINI_API_KEY, process.env.CRON_SECRET];
  return known.some(secret => typeof secret === "string" && secret.length >= 16 && value.includes(secret))
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value)
    || /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
    || /(?:[?&]|\b)(?:authorization|auth|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|signature|session[_-]?key)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/%=-]{8,}/i.test(value);
}

export function agentJson(value: unknown, status = 200, stream = false) {
  const text = JSON.stringify(value);
  if (hasCredentialLikeValue(text)) throw new ProgramApiError(500, "RESPONSE_UNAVAILABLE");
  const headers = { ...AGENT_RESPONSE_HEADERS, "Content-Type": "application/json; charset=utf-8" };
  if (!stream) return new Response(text, { status, headers });
  // Full extracted text is streamed, never silently clipped to a platform buffer limit.
  const bytes = new TextEncoder().encode(text);
  let position = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (position >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(position, position + 64 * 1024)); position += 64 * 1024;
  } }), { status, headers });
}

export function agentError(error: unknown) {
  return agentJson({ error: error instanceof ProgramApiError ? error.code : "REQUEST_FAILED" },
    error instanceof ProgramApiError ? error.status : 500);
}

export async function readAgentJson(request: Request) {
  const maximum = 64 * 1024;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ProgramApiError(415, "JSON_REQUIRED");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ProgramApiError(413, "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new ProgramApiError(400, "INVALID_BODY");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ProgramApiError(413, "BODY_TOO_LARGE"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProgramApiError(400, "INVALID_BODY");
    if (hasCredentialLikeValue(raw) || hasCredentialLikeValue(JSON.stringify(value))) throw new ProgramApiError(400, "SENSITIVE_VALUE_REJECTED");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProgramApiError) throw error;
    throw new ProgramApiError(400, "INVALID_BODY");
  } finally { reader.releaseLock(); }
}
