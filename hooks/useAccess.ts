"use client";

import { useCallback, useEffect, useState } from "react";

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

/**
 * 확인 결과를 얼마나 믿고 다시 쓸지.
 *
 * 예전에는 한 번 받은 결과를 탭이 살아 있는 내내 그대로 썼습니다. 그래서
 * 권한을 거둬들여도 화면은 계속 열려 있었습니다. 오 분마다 다시 물어보면
 * 매번 왕복하지 않으면서도 바뀐 권한이 곧 반영됩니다.
 */
const CACHE_TTL_MS = 5 * 60 * 1_000;

type CachedAccess = { access: AccessState; storedAt: number };

const accessCache = new Map<string, CachedAccess>();
const pendingAccess = new Map<string, Promise<AccessState>>();

function cachedAccess(identity: string) {
  const cached = accessCache.get(identity);
  if (!cached) return null;
  if (Date.now() - cached.storedAt > CACHE_TTL_MS) {
    accessCache.delete(identity);
    return null;
  }
  return cached.access;
}

function requestAccess(identity: string) {
  const pending = pendingAccess.get(identity);
  if (pending) return pending;

  const request = fetch("/api/auth/access", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("권한 정보를 확인하지 못했습니다.");
      return response.json() as Promise<AccessState>;
    })
    .then((value) => {
      accessCache.set(identity, { access: value, storedAt: Date.now() });
      return value;
    })
    .finally(() => pendingAccess.delete(identity));

  pendingAccess.set(identity, request);
  return request;
}

type AccessResult = {
  identity: string;
  access: AccessState;
  error: string;
};

export function useAccess(userEmail?: string | null) {
  const identity = userEmail?.trim().toLowerCase() || "";
  const [result, setResult] = useState<AccessResult | null>(null);
  // 다시 확인을 요청할 때마다 올려서 아래 effect 를 한 번 더 돌립니다.
  const [attempt, setAttempt] = useState(0);
  const current = result?.identity === identity ? result : null;

  useEffect(() => {
    if (!identity) return;

    let active = true;
    const load = () => {
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
    };

    load();
    // 화면을 열어 둔 채로도 주기적으로 다시 물어봅니다. 캐시에 유효기간만
    // 두면 소용이 없습니다. 만료되어도 화면이 들고 있는 예전 결과가 그대로
    // 나가서, 권한을 거둬들여도 탭이 살아 있는 동안은 열린 채로 남습니다.
    const timer = setInterval(() => {
      accessCache.delete(identity);
      load();
    }, CACHE_TTL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [identity, attempt]);

  /**
   * 다시 확인합니다.
   *
   * 예전에는 이 길이 없었습니다. 확인이 한 번 실패하면 결과가 그대로 남고
   * effect 를 다시 돌릴 것이 없어서, 잠깐의 네트워크 오류 하나로 화면이
   * "권한 없음" 상태에 굳었습니다. 새로고침 말고는 빠져나갈 방법이 없었습니다.
   */
  const retry = useCallback(() => {
    if (!identity) return;
    accessCache.delete(identity);
    pendingAccess.delete(identity);
    setResult(null);
    setAttempt((value) => value + 1);
  }, [identity]);

  if (!identity) return { ...EMPTY_ACCESS, loading: false, error: "", retry };

  const cached = cachedAccess(identity);
  if (cached) return { ...cached, loading: false, error: "", retry };
  if (current) return { ...current.access, loading: false, error: current.error, retry };
  return { ...EMPTY_ACCESS, loading: true, error: "", retry };
}
