import { authenticatedAdmin } from "@/lib/content-ops/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentError, agentJson, ProgramApiError, readAgentJson } from "./agent-auth.ts";
import { ProgramAdminService } from "./admin-api.ts";

type AdminUser = { id: string; email?: string };
type AdminWork = (service: ProgramAdminService, user: AdminUser, body?: Record<string, unknown>) => Promise<unknown>;
function cookieResponse(response: Response) { response.headers.set("Vary", "Cookie"); return response; }

export async function programAdminRoute(request: Request, work: AdminWork, options: { stream?: boolean; status?: number } = {}) {
  try {
    const user = await authenticatedAdmin();
    if (!user) return cookieResponse(agentJson({ error: "Unauthorized" }, 401));
    let body: Record<string, unknown> | undefined;
    if (request.method === "POST") {
      if (request.headers.get("origin") !== new URL(request.url).origin) throw new ProgramApiError(403, "ORIGIN_REJECTED");
      body = await readAgentJson(request);
    }
    const result = await work(new ProgramAdminService(createAdminClient()), user, body);
    return cookieResponse(result instanceof Response ? result : agentJson(result, options.status ?? 200, options.stream));
  } catch (error) { return cookieResponse(agentError(error)); }
}
