const DEFAULT_ADMIN_EMAILS = ["miseong0928@gmail.com"];
const DEFAULT_PARTNER_EMAILS: string[] = [];

function parseEmails(value?: string) {
  return value
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getAdminEmails() {
  const configured = parseEmails(process.env.ADMIN_EMAILS);

  return configured?.length ? configured : DEFAULT_ADMIN_EMAILS;
}

export function getPartnerEmails() {
  const configured = parseEmails(process.env.PARTNER_EMAILS);

  return configured?.length ? configured : DEFAULT_PARTNER_EMAILS;
}

export function isAdmin(email?: string | null) {
  return Boolean(email && getAdminEmails().includes(email.toLowerCase()));
}

export function isPartner(email?: string | null) {
  return Boolean(email && getPartnerEmails().includes(email.toLowerCase()));
}

export function canUsePartnerPortal(email?: string | null) {
  return isAdmin(email) || isPartner(email);
}
