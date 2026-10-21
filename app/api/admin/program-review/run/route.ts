import { authenticatedAdmin } from "@/lib/content-ops/data";
import { runRequirementsTask } from "@/lib/program-review/requirements-runner";
import { MatchProfilesError } from "@/lib/program-review/profiles-run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" };

function form(result = "") {
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>공고 요건 운영 검증</title>
    <main><h1>공고 요건 운영 검증</h1><p>프로필 조회를 이어서 처리하고, 캐시가 완성되면 요건 추출·매칭을 실행합니다.</p>
    <p>한 번에 신규 요건 최대 2건을 처리합니다.</p><pre>${result}</pre>
    <form method="post"><button type="submit">요건 검증 실행</button></form></main></html>`, { headers });
}

export async function GET() {
  if (!(await authenticatedAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return form();
}

export async function POST(request: Request) {
  if (!(await authenticatedAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Cookie-authenticated writes must originate from the same site.
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "허용하지 않는 요청입니다." }, { status: 403 });
  }
  try {
    const result = await runRequirementsTask();
    return form(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof MatchProfilesError ? `고객 프로필 확인 보류 (${error.code}): ${error.message}`
      : "공고 요건 검증을 완료하지 못했습니다. 비공개 운영 설정과 조회 상태를 확인하세요.";
    return new Response(message,
      { status: 500, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
}
