import { authenticatedAdmin } from "@/lib/content-ops/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRequirementsTask } from "@/lib/program-review/requirements-runner";
import { runAttachmentTask } from "@/lib/program-review/attachment-runner";
import { withReviewJob } from "@/lib/program-review/jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function escape(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function form(result: Record<string, unknown> = {}) {
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>공고 요건 운영 검증</title>
    <main><h1>공고 요건 운영 검증</h1>
    <p>최근 60일 수집분을 독립 검증합니다. 기존 승인·발행 상태는 유지됩니다.</p>
    <p>1회 최대 100건, 실행 시간 안에서 처리합니다. 남은 공고는 다음 실행에서 이어집니다.</p>
    <pre>${escape(JSON.stringify(result, null, 2))}</pre>
    <form method="post"><input type="hidden" name="task" value="attachments">
      <button type="submit">마감일 확인 공고 첨부 처리</button></form>
    <form method="post"><input type="hidden" name="task" value="attachments_all">
      <button type="submit">마감일 미상 포함 첨부 처리</button></form>
    <form method="post"><input type="hidden" name="task" value="requirements">
      <button type="submit">마감일 확인 공고 요건·매칭 실행</button></form>
    <form method="post"><input type="hidden" name="task" value="all">
      <button type="submit">마감일 미상 포함 요건·매칭 실행</button></form>
    <form method="post"><input type="hidden" name="task" value="recover">
      <p>같은 원문으로 실패한 공고는 자동 재호출하지 않습니다. 수동 복구는 공고·원문별 1회만 기록됩니다.</p>
      <label>실패 공고 ID <input name="programId" required pattern="[0-9a-fA-F-]{36}"></label>
      <button type="submit">실패 공고 1회 복구</button></form></main></html>`, { headers });
}
export async function GET() {
  if (!(await authenticatedAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return form();
}
export async function POST(request: Request) {
  if (!(await authenticatedAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "허용되지 않는 요청입니다." }, { status: 403 });
  }
  try {
    const fields = await request.formData();
    const task = fields.get("task");
    if (task === "attachments" || task === "attachments_all") {
      const result = await withReviewJob(createAdminClient(), "attachments", () => runAttachmentTask({
        maxProcessed: 100, maxDiscovered: 100, includeExcluded: true, lookbackDays: 60,
        knownDeadlineOnly: task === "attachments",
      }));
      return form(result);
    }
    if (task === "recover") {
      const id = fields.get("programId");
      if (typeof id !== "string" || !uuid.test(id)) return Response.json({ error: "공고 ID를 확인하세요." }, { status: 400 });
      return form(await runRequirementsTask({ recoveryProgramId: id, programIds: [id], limit: 1 }));
    }
    if (task !== "requirements" && task !== "all") return Response.json({ error: "실행 종류를 확인하세요." }, { status: 400 });
    if (task === "all") return form(await runRequirementsTask());
    const now = new Date();
    const { data, error } = await createAdminClient().from("openchat_programs").select("id")
      .gte("created_at", new Date(now.getTime() - 60 * 86400_000).toISOString())
      .gte("deadline_at", now.toISOString()).order("deadline_at").limit(1000)
      .abortSignal(AbortSignal.timeout(20_000));
    if (error) throw new Error("REVIEW_SCOPE_FAILED");
    if (!data?.length) return form({ eligible: 0, considered: 0 });
    return form(await runRequirementsTask({ programIds: data.map((p) => p.id) }));
  } catch {
    return new Response("운영 검증을 완료하지 못했습니다. 비공개 실행 기록의 단계별 진단을 확인하세요.",
      { status: 500, headers });
  }
}
