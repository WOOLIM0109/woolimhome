import { programAgentRoute } from "@/lib/program-review/agent-route";
import { readAgentJson } from "@/lib/program-review/agent-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return programAgentRoute(request, async service => service.appendReview((await context.params).id, await readAgentJson(request)), { status: 201 });
}
