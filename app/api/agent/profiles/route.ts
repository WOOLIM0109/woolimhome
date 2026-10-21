import { programAgentRoute } from "@/lib/program-review/agent-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) { return programAgentRoute(request, service => service.profiles()); }
