/**
 * 요청 횟수 제한.
 *
 * 공개된 주소를 아무 제한 없이 열어 두면 한 사람이 원하는 만큼 부를 수 있고,
 * 그 비용은 우리가 냅니다. 특히 문의 폼은 한 번 부를 때마다 바깥으로 두 번
 * 나가므로, 부르는 쪽이 우리 비용을 정하는 셈이 됩니다.
 *
 * 기억은 서버 한 대 안에만 남습니다. 여러 대로 늘어나거나 다시 뜨면 초기화되니
 * 완전한 차단은 아닙니다. 다만 한 곳에서 몰아치는 흔한 남용은 이것으로 대부분
 * 막히고, 별도 저장소 없이 지금 바로 넣을 수 있습니다. 더 단단히 막아야 할
 * 때는 같은 판단을 데이터베이스로 옮기면 됩니다.
 */

export type RateLimitVerdict = {
  allowed: boolean;
  /** 막혔을 때 몇 초 뒤에 다시 시도하면 되는지. */
  retryAfterSeconds: number;
};

export type RateLimiterOptions = {
  /** 창 하나에서 허용할 횟수. */
  limit: number;
  /** 창의 길이(밀리초). */
  windowMs: number;
  /**
   * 기억할 최대 주체 수. 주소를 바꿔 가며 부르면 기억이 끝없이 늘어나
   * 그 자체가 공격이 됩니다. 넘치면 오래된 것부터 버립니다.
   */
  maxKeys?: number;
};

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: RateLimiterOptions) {
  // 키마다 최근 통과 시각을 오름차순으로 들고 있습니다.
  const hits = new Map<string, number[]>();

  function evictIfCrowded() {
    if (hits.size <= maxKeys) return;
    // Map 은 넣은 순서를 지키므로 맨 앞이 가장 오래된 키입니다.
    const overflow = hits.size - maxKeys;
    let removed = 0;
    for (const key of hits.keys()) {
      hits.delete(key);
      if (++removed >= overflow) break;
    }
  }

  return {
    check(key: string, now = Date.now()): RateLimitVerdict {
      const windowStart = now - windowMs;
      const recent = (hits.get(key) || []).filter((at) => at > windowStart);

      // 막을 때도 기억을 가장 최근으로 옮깁니다. 그러지 않으면 계속 두드리는
      // 쪽이 먼저 잊혀지고, 새 키를 잔뜩 만들어 자기 기록을 밀어내면 제한을
      // 그대로 빠져나갈 수 있습니다.
      hits.delete(key);

      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterMs = recent[0] + windowMs - now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
        };
      }

      recent.push(now);
      hits.set(key, recent);
      evictIfCrowded();
      return { allowed: true, retryAfterSeconds: 0 };
    },

    /** 시험과 진단용. 지금 몇 개를 기억하고 있는지. */
    size() {
      return hits.size;
    },
  };
}

/**
 * 요청을 보낸 쪽을 가리키는 값.
 *
 * 프록시를 거치므로 헤더에서 읽습니다. 아무것도 없으면 하나로 묶어 셉니다.
 * 정확도보다 "누가 몰아치는가"를 잡는 것이 목적입니다.
 */
export function requesterKey(headers: { get(name: string): string | null }) {
  const raw = headers.get("cf-connecting-ip")
    || headers.get("x-real-ip")
    || headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "";
  return raw || "unknown";
}
