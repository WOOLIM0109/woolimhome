import { programAdminRoute } from "@/lib/program-review/admin-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return programAdminRoute(request, async (service, user, body) => service.reviewProposal((await context.params).id, body!, user.email ?? user.id));
}
