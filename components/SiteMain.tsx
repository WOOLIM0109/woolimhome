"use client";

import { usePathname } from "next/navigation";

const publicSections = ["/about", "/services", "/portfolio", "/success", "/contact", "/news", "/columns"];

export default function SiteMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname === "/" || publicSections.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return <main className={isPublic ? "public-site" : undefined}>{children}</main>;
}
