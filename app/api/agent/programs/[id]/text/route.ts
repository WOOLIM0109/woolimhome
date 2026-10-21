import { programAgentRoute } from "@/lib/program-review/agent-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return programAgentRoute(request, async service => {
    const params = new URL(request.url).searchParams;
    if (params.size > 1 || [...params.keys()].some(key => key !== "attachment")) {
      const { ProgramApiError } = await import("@/lib/program-review/agent-auth");
      throw new ProgramApiError(400, "INVALID_QUERY");
    }
    return service.text((await context.params).id, params.get("attachment") ?? undefined);
  }, { stream: true });
}
