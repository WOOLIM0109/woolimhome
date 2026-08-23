import { NextResponse } from "next/server";
import { authenticatedAdmin } from "@/lib/content-ops/data";
import { automationBudgetStatus } from "@/lib/gemini/automation";

export const dynamic = "force-dynamic";

/**
 * 지금 걸려 있는 상한과 이번 달 사용량을 그대로 보여 줍니다.
 *
 * 상한 값은 Vercel 환경변수에 들어 있는데, Sensitive 로 저장하면 만든 뒤에는
 * 다시 볼 수 없습니다. 화면에도 보여 주는 곳이 없어서, 초안 생성이 막혔을 때
 * 무엇이 얼마나 남았는지 확인할 길이 아예 없었습니다.
 *
 * Gemini 를 부르지 않습니다. 이 화면을 여는 것만으로는 요금이 들지 않습니다.
 */
export async function GET() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await automationBudgetStatus();
  return NextResponse.json({
    enabled: status.enabled,
    reason: status.reason,
    usage: status.usage,
    limits: {
      dailyCalls: status.config.dailyCalls,
      monthlyCalls: status.config.monthlyCalls,
      dailyCostUsd: status.config.dailyCostUsd,
      monthlyCostUsd: status.config.monthlyCostUsd,
    },
    // 기록된 금액이 실제 청구액이 아니라는 것을 화면에서도 알 수 있어야 합니다.
    // 단가를 크게 잡아 두었기 때문에, 실제로 나간 돈보다 앞서 상한에 닿습니다.
    pricing: {
      inputUsdPerMillionTokens: status.config.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: status.config.outputUsdPerMillionTokens,
    },
    remaining: {
      dailyCalls: status.remainingDailyCalls,
      monthlyCalls: status.remainingMonthlyCalls,
      monthlyCostUsd: status.remainingMonthlyCostUsd,
      dailyCostUsd: Math.max(0, status.config.dailyCostUsd - status.usage.dailyCostUsed),
    },
  }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
