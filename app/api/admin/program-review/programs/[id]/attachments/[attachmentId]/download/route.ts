import { programAdminRoute } from "@/lib/program-review/admin-route";
import { ProgramApiError } from "@/lib/program-review/agent-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  return programAdminRoute(request, async service => {
    if (new URL(request.url).searchParams.size) throw new ProgramApiError(400, "INVALID_QUERY");
    const { id, attachmentId } = await context.params;
    return service.download(id, attachmentId);
  });
}
