import { programAdminRoute } from "@/lib/program-review/admin-route";
import { ProgramApiError } from "@/lib/program-review/agent-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** '고객사 전달' 탭. 고객사마다 오늘 보낼 문구를 돌려줍니다. 보내는 것은 사람이 합니다. */
export async function GET(request: Request) {
  return programAdminRoute(request, service => service.deliveries());
}

/**
 * `{ action: "sent", customer_id, program_ids, review_date }` — 보냈다고 적습니다.
 * `{ action: "undo", id }` — 잘못 누른 것을 되돌립니다.
 */
export async function POST(request: Request) {
  return programAdminRoute(request, (service, user, body) => {
    const { action, ...rest } = body ?? {};
    if (action === "sent") return service.markDelivered(rest, user.email ?? user.id);
    if (action === "undo") return service.undoDelivery(rest);
    throw new ProgramApiError(400, "INVALID_ACTION");
  });
}
