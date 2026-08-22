import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter, requesterKey } from "./rate-limit.ts";

const START = 1_000_000;

test("창 안에서 정해진 횟수까지만 통과시킨다", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(limiter.check("가", START + attempt).allowed, true);
  }
  assert.equal(limiter.check("가", START + 3).allowed, false);
});

test("막을 때 언제 다시 오면 되는지 알려 준다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  limiter.check("가", START);
  const verdict = limiter.check("가", START + 10_000);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.retryAfterSeconds, 50);
});

test("창이 지나면 다시 받아 준다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.check("가", START).allowed, true);
  assert.equal(limiter.check("가", START + 59_000).allowed, false);
  assert.equal(limiter.check("가", START + 60_001).allowed, true);
});

test("주체가 다르면 서로 영향을 주지 않는다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.check("가", START).allowed, true);
  assert.equal(limiter.check("나", START).allowed, true);
  assert.equal(limiter.check("가", START).allowed, false);
});

/**
 * 주소를 바꿔 가며 부르면 기억이 끝없이 늘어나 그 자체가 공격이 됩니다.
 */
test("기억할 주체 수에 상한이 있다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
  for (let index = 0; index < 100; index += 1) {
    limiter.check(`손님-${index}`, START + index);
  }
  assert.ok(limiter.size() <= 10, `기억이 ${limiter.size()}개까지 늘었습니다`);
});

test("최근에 부른 주체가 먼저 버려지지 않는다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
  limiter.check("단골", START);
  limiter.check("뜨내기", START + 1);
  // 단골이 다시 부르면 가장 최근으로 올라갑니다.
  limiter.check("단골", START + 2);
  limiter.check("새손님", START + 3);
  // 자리가 밀리면 뜨내기가 먼저 빠지고, 단골의 기록은 남아 있어야 합니다.
  assert.equal(limiter.check("단골", START + 4).allowed, false);
});

test("헤더에서 요청한 쪽을 찾아낸다", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null });
  assert.equal(requesterKey(headers({ "cf-connecting-ip": "1.1.1.1" })), "1.1.1.1");
  assert.equal(requesterKey(headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
  assert.equal(requesterKey(headers({})), "unknown");
});
