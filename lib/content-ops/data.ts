import { canUsePartnerPortal, isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function authenticatedAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAdmin(user.email) ? user : null;
}

export async function authenticatedPartner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && canUsePartnerPortal(user.email) ? user : null;
}

export function contentAdmin() {
  return createAdminClient();
}
