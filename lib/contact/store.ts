import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

export type ContactInquiry = {
  track: "consulting" | "business-docs" | "design" | "etc";
  name: string;
  phone: string;
  email: string | null;
  message: string;
  details: Record<string, string>;
  source_path: string | null;
  requester_key: string;
};
export type StoredInquiry = { id: string; created_at: string };

export async function storeContactInquiry(inquiry: ContactInquiry, client = createAdminClient()): Promise<StoredInquiry> {
  const { data, error } = await client.from("contact_inquiries").insert(inquiry).select("id,created_at").single();
  if (error || !data?.id || !data.created_at) throw new Error("Contact inquiry database save failed");
  return { id: data.id, created_at: data.created_at };
}

export async function recordContactNotification(id: string, status: { notified_at: string | null; notify_error: string | null }, client = createAdminClient()) {
  const { data, error } = await client.from("contact_inquiries").update(status).eq("id", id).select("id").single();
  if (error || !data?.id) throw new Error("Contact notification status update failed");
}
