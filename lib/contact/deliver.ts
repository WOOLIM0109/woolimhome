import "server-only";
import { notifyContactInquiry } from "./notify.ts";
import { submitGoogleForm } from "./google-form.ts";
import type { ContactInquiry, StoredInquiry } from "./store.ts";

export async function deliverContactInquiry(saved: StoredInquiry, inquiry: ContactInquiry, dependencies = { notify: notifyContactInquiry, google: submitGoogleForm }) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => dependencies.notify(saved, inquiry)),
    Promise.resolve().then(() => dependencies.google(inquiry)),
  ]);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") console.error(index === 0 ? "Contact notification status persistence failed" : "Contact Google Form parallel submission failed", saved.id);
  }
}
