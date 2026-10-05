import { after } from "next/server";
import { createContactHandler } from "@/lib/contact/handler";
import { storeContactInquiry } from "@/lib/contact/store";
import { deliverContactInquiry } from "@/lib/contact/deliver";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createContactHandler({
  store: storeContactInquiry,
  deliver: deliverContactInquiry,
  defer: (task) => after(task),
});
