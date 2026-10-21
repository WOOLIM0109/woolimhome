import { createAdminClient } from "@/lib/supabase/admin";
import { agentError, agentJson, authorizeProgramAgent } from "./agent-auth.ts";
import { ProgramAgentService } from "./agent-api.ts";

export async function programAgentRoute(request: Request, work: (service: ProgramAgentService) => Promise<unknown>, options: { stream?: boolean; status?: number } = {}) {
  if (!authorizeProgramAgent(request)) return agentJson({ error: "Unauthorized" }, 401);
  try { return agentJson(await work(new ProgramAgentService(createAdminClient())), options.status ?? 200, options.stream); }
  catch (error) { return agentError(error); }
}
