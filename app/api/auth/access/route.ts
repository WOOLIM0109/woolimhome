import { NextResponse } from "next/server";
import { canUsePartnerPortal, isAdmin, isPartner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email || null;
  return NextResponse.json({
    authenticated: Boolean(user),
    admin: isAdmin(email),
    partner: isPartner(email),
    partnerPortal: canUsePartnerPortal(email),
  }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
