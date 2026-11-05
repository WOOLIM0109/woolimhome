import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";
import {
  activeComparisonWaiver,
  comparisonWaiverHistory,
  isComparisonWaiverReason,
  type ComparisonWaiverEvent,
} from "@/lib/portfolio/comparison-waiver";

function databaseFailure(error: { message: string; code?: string }) {
  const missingColumn = ["42703", "PGRST204"].includes(error.code || "")
    && error.message.includes("comparison_waiver");
  return NextResponse.json({ error: missingColumn
    ? "비교 대상 표시를 저장하려면 20261105061540_portfolio_publication_comparison_waiver.sql 마이그레이션을 먼저 적용해 주세요."
    : error.message }, { status: missingColumn ? 503 : 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "발행 기록 ID가 올바르지 않습니다." }, { status: 400 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "요청 내용을 확인해 주세요." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !["waive", "restore"].includes(body.action)
    || !Array.isArray(body.expectedHistory)
    || comparisonWaiverHistory(body.expectedHistory).length !== body.expectedHistory.length
    || (body.action === "waive" && !isComparisonWaiverReason(body.reason))) {
    return NextResponse.json({ error: "표시 동작과 정해진 이유, 현재 표시 이력을 보내 주세요." }, { status: 400 });
  }
  const admin = contentAdmin();
  const { data: row, error } = await admin.from("portfolio_publication_ledger")
    .select("id,comparison_waiver").eq("id", id).maybeSingle();
  if (error) return databaseFailure(error);
  if (!row) return NextResponse.json({ error: "발행 기록을 찾을 수 없습니다." }, { status: 404 });
  const history = comparisonWaiverHistory(row.comparison_waiver);
  if (!Array.isArray(row.comparison_waiver) || history.length !== row.comparison_waiver.length) {
    return NextResponse.json({ error: "저장된 표시 이력을 확인할 수 없습니다. 관리자에게 확인해 주세요." }, { status: 409 });
  }
  const expectedHistory = comparisonWaiverHistory(body.expectedHistory);
  const waiver = activeComparisonWaiver(history);
  if (JSON.stringify(history) !== JSON.stringify(expectedHistory)
    || (body.action === "restore" ? !waiver : Boolean(waiver))) {
    return NextResponse.json({ error: "다른 요청에서 표시를 변경했습니다. 미리보기를 새로 불러와 주세요." }, { status: 409 });
  }
  const event: ComparisonWaiverEvent = {
    action: body.action,
    reason: body.action === "restore" ? waiver!.reason : body.reason,
    actor: user.email || user.id,
    at: new Date().toISOString(),
  };
  const waiverHistory = [...history, event];
  const { data: updated, error: updateError } = await admin.from("portfolio_publication_ledger")
    .update({ comparison_waiver: waiverHistory }).eq("id", id)
    .eq("comparison_waiver", JSON.stringify(row.comparison_waiver)).select("id").maybeSingle();
  if (updateError) return databaseFailure(updateError);
  if (!updated) {
    return NextResponse.json({ error: "다른 요청에서 표시를 변경했습니다. 미리보기를 새로 불러와 주세요." }, { status: 409 });
  }
  return NextResponse.json({ success: true, waiver: activeComparisonWaiver(waiverHistory), waiverHistory },
    { headers: { "Cache-Control": "no-store" } });
}
