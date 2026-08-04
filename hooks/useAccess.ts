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

export function useAccess(enabled = true) {
  const [access, setAccess] = useState<AccessState>(EMPTY_ACCESS);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    fetch("/api/auth/access", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("권한 정보를 확인하지 못했습니다.");
        return response.json() as Promise<AccessState>;
      })
      .then((value) => {
        setAccess(value);
        setError("");
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setAccess(EMPTY_ACCESS);
        setError(caught instanceof Error ? caught.message : "권한 정보를 확인하지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled]);

  return enabled ? { ...access, loading, error } : { ...EMPTY_ACCESS, loading: false, error: "" };
}
