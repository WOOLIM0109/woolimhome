const DEFAULT_ADMIN_EMAILS = ["miseong0928@gmail.com"];

export function getAdminEmails() {
  const configured = process.env.ADMIN_EMAILS
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return configured?.length ? configured : DEFAULT_ADMIN_EMAILS;
}

export function isAdmin(email?: string | null) {
  return Boolean(email && getAdminEmails().includes(email.toLowerCase()));
}
