import { programAdminRoute } from "@/lib/program-review/admin-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) { return programAdminRoute(request, service => service.overview(), { stream: true }); }
