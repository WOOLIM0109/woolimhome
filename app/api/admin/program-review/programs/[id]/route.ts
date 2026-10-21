import { programAdminRoute } from "@/lib/program-review/admin-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return programAdminRoute(request, async service => service.detail((await context.params).id), { stream: true });
}
