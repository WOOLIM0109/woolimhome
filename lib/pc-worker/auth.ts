import { NextResponse } from "next/server";
import {
  authorizeWorkerCredential,
  resolveWorkerIdentity,
  type WorkerIdentity,
} from "@/lib/pc-worker/identity";

export { PC_WORKER_ID } from "@/lib/pc-worker/identity";

export type WorkerAuthentication =
  | { worker: WorkerIdentity; response: null }
  | { worker: null; response: NextResponse };

export function authenticateWorker(request: Request, body?: unknown): WorkerAuthentication {
  const worker = resolveWorkerIdentity(request.headers, body);
  if (!worker) {
    return {
      worker: null,
      response: NextResponse.json({ error: "Invalid worker identity" }, { status: 400 }),
    };
  }
  if (!authorizeWorkerCredential(worker, request.headers.get("authorization"))) {
    return {
      worker: null,
      response: NextResponse.json({ error: "Unauthorized worker" }, { status: 401 }),
    };
  }
  return { worker, response: null };
}

// Retained for compatibility with any server code deployed independently of
// the worker routes. New code should use authenticateWorker to get the identity.
export function authorizeWorker(request: Request) {
  return authenticateWorker(request).response;
}

export function workerBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://woolim-site.vercel.app";
}
