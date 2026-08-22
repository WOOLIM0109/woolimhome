import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * 크론 요청 인증.
 *
 * PC 워커 쪽은 이미 timingSafeEqual 로 비교하는데 크론만 문자열 비교라
 * 방식이 갈려 있었습니다. 한 곳으로 모아 같은 방식으로 맞춥니다.
 */
function equalSecret(supplied: string, expected: string) {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function authorizeCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  // 시크릿이 없으면 열어 두지 않고 막습니다.
  if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!equalSecret(authorization.slice("Bearer ".length), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
