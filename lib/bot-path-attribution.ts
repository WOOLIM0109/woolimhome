export type BotPageKind =
  | "home"
  | "company"
  | "service"
  | "project"
  | "case"
  | "column"
  | "news"
  | "contact"
  | "other";

export interface BotPathAttribution {
  pageKind: BotPageKind;
  entitySlug: string | null;
}

function segment(parts: string[], index: number) {
  const raw = parts[index];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function attributeBotPath(pathname: string): BotPathAttribution {
  if (!pathname || pathname === "/") return { pageKind: "home", entitySlug: null };
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const head = parts[0];
  if (head === "about") return { pageKind: "company", entitySlug: null };
  if (head === "services") return { pageKind: "service", entitySlug: segment(parts, 1) };
  if (head === "projects") return { pageKind: "project", entitySlug: segment(parts, 1) };
  if (head === "cases") return { pageKind: "case", entitySlug: segment(parts, 1) };
  if (head === "columns") return { pageKind: "column", entitySlug: segment(parts, 1) };
  if (head === "news") return { pageKind: "news", entitySlug: segment(parts, 1) };
  if (head === "contact") return { pageKind: "contact", entitySlug: null };
  return { pageKind: "other", entitySlug: segment(parts, 1) };
}
