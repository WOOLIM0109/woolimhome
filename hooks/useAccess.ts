"use client";

import { useEffect, useState } from "react";

type AccessState = {
  authenticated: boolean;
  admin: boolean;
  partner: boolean;
  partnerPortal: boolean;
};

const EMPTY_ACCESS: AccessState = {
  authenticated: false,
  admin: false,
  partner: false,
  partnerPortal: false,
};

type AccessResult = {
  identity: string;
  access: AccessState;
  error: string;
};

const accessCache = new Map<string, AccessState>();
const pendingAccess = new Map<string, Promise<AccessState>>();

function requestAccess(identity: string) {
  const pending = pendingAccess.get(identity);
  if (pending) return pending;

  const request = fetch("/api/auth/access", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("권한 정보를 확인하지 못했습니다.");
      return response.json() as Promise<AccessState>;
    })
    .then((value) => {
      accessCache.set(identity, value);
      return value;
    })
    .finally(() => pendingAccess.delete(identity));

  pendingAccess.set(identity, request);
  return request;
}

export function useAccess(userEmail?: string | null) {
  const identity = userEmail?.trim().toLowerCase() || "";
  const cached = identity ? accessCache.get(identity) : undefined;
  const [result, setResult] = useState<AccessResult | null>(null);
  const current = result?.identity === identity ? result : null;

  useEffect(() => {
    if (!identity || accessCache.has(identity)) return;

    let active = true;
    requestAccess(identity)
      .then((value) => {
        if (active) setResult({ identity, access: value, error: "" });
      })
      .catch((caught) => {
        if (!active) return;
        setResult({
          identity,
          access: EMPTY_ACCESS,
          error: caught instanceof Error ? caught.message : "권한 정보를 확인하지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [identity]);

  if (!identity) return { ...EMPTY_ACCESS, loading: false, error: "" };
  if (cached) return { ...cached, loading: false, error: "" };
  if (current) return { ...current.access, loading: false, error: current.error };
  return { ...EMPTY_ACCESS, loading: true, error: "" };
}
