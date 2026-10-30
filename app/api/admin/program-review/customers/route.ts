import { programAdminRoute } from "@/lib/program-review/admin-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 울림웍스 목록을 한 번 읽습니다. 기본 제한(10초)으로는 모자랄 수 있습니다.
export const maxDuration = 60;

/** 고객사 요건 화면이 읽는 곳. 울림웍스 목록에 우리가 적어 둔 요건을 붙여 줍니다. */
export async function GET(request: Request) {
  return programAdminRoute(request, service => service.customerProfiles());
}

/** 사업자 한 개의 요건을 적습니다. 누가 적었는지 남깁니다. */
export async function POST(request: Request) {
  return programAdminRoute(request, (service, user, body) =>
    service.saveCustomerProfile(body, user.email ?? user.id));
}
