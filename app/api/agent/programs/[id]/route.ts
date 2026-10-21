import { programAgentRoute } from "@/lib/program-review/agent-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return programAgentRoute(request, async service => service.detail((await context.params).id), { stream: true });
}
