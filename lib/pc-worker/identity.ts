import { timingSafeEqual } from "node:crypto";

export const PC_WORKER_ID = "becky-office-pc";
export const PC_WORKER_NAME = "울림 집 PC (기존)";

// Updated workers renew this lease while a document is being converted. Truly
// legacy workers do not send an identity and get a longer lease so an in-flight
// deployment cannot cause their work to be reclaimed prematurely.
export const PC_WORKER_LEASE_SECONDS = 15 * 60;
export const LEGACY_PC_WORKER_LEASE_SECONDS = 2 * 60 * 60;

const WORKER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MAX_WORKER_NAME_LENGTH = 80;

type RequestHeaders = {
  get(name: string): string | null;
};

type WorkerEnvironment = {
  PC_WORKER_SECRET?: string;
  PC_WORKER_SECRETS?: string;
  PC_WORKER_ALLOW_LEGACY?: string;
};

export type WorkerIdentity = {
  id: string;
  displayName: string;
  legacy: boolean;
};

function bodyValue(body: unknown, key: "workerId" | "workerName") {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : null;
}

function cleanDisplayName(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WORKER_NAME_LENGTH);
}

export function resolveWorkerIdentity(headers: RequestHeaders, body?: unknown): WorkerIdentity | null {
  const headerId = headers.get("x-woolim-worker-id")?.trim();
  const bodyId = bodyValue(body, "workerId");
  const suppliedId = headerId || bodyId;
  const legacy = !suppliedId;
  const id = suppliedId || PC_WORKER_ID;
  if (!WORKER_ID_PATTERN.test(id)) return null;

  const suppliedName = headers.get("x-woolim-worker-name")?.trim()
    || bodyValue(body, "workerName")
    || (legacy ? PC_WORKER_NAME : id);
  const displayName = cleanDisplayName(suppliedName);
  if (!displayName) return null;

  return { id, displayName, legacy };
}

export function parseWorkerSecrets(raw: string | undefined) {
  const configured = Boolean(raw?.trim());
  if (!configured) return { configured: false, secrets: {} as Record<string, string> };

  try {
    const parsed = JSON.parse(raw as string);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { configured: true, secrets: {} as Record<string, string> };
    }
    const secrets = Object.fromEntries(
      Object.entries(parsed)
        .filter(([id, secret]) => WORKER_ID_PATTERN.test(id)
          && typeof secret === "string"
          && Boolean(secret)),
    ) as Record<string, string>;
    return { configured: true, secrets };
  } catch {
    // A malformed registry must fail closed for workers that declare an ID.
    return { configured: true, secrets: {} as Record<string, string> };
  }
}

function equalSecret(supplied: string, expected: string) {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function authorizeWorkerCredential(
  identity: WorkerIdentity,
  authorization: string | null,
  environment: WorkerEnvironment = {
    PC_WORKER_SECRET: process.env.PC_WORKER_SECRET,
    PC_WORKER_SECRETS: process.env.PC_WORKER_SECRETS,
    PC_WORKER_ALLOW_LEGACY: process.env.PC_WORKER_ALLOW_LEGACY,
  },
) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (!supplied) return false;

  const registry = parseWorkerSecrets(environment.PC_WORKER_SECRETS);
  const allowLegacy = environment.PC_WORKER_ALLOW_LEGACY?.trim().toLowerCase() !== "false";
  if (identity.legacy && !allowLegacy) return false;

  const candidates: string[] = [];
  const workerSecret = registry.secrets[identity.id];
  if (workerSecret) candidates.push(workerSecret);

  // Requests from the deployed legacy script must continue to accept the
  // original shared secret, even after the per-worker registry is enabled.
  if (allowLegacy && identity.legacy && environment.PC_WORKER_SECRET) {
    candidates.push(environment.PC_WORKER_SECRET);
  } else if (allowLegacy && !registry.configured && environment.PC_WORKER_SECRET) {
    // This is the rollout bridge for updated workers before per-ID secrets are
    // configured. Once PC_WORKER_SECRETS exists, explicit IDs require a match.
    candidates.push(environment.PC_WORKER_SECRET);
  }

  return candidates.some((expected) => equalSecret(supplied, expected));
}

export function workerLeaseSeconds(identity: WorkerIdentity) {
  return identity.legacy
    ? LEGACY_PC_WORKER_LEASE_SECONDS
    : PC_WORKER_LEASE_SECONDS;
}
