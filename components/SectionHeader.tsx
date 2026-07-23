import Link from "next/link";
import { ArrowRight } from "lucide-react";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  light?: boolean;
  linkHref?: string;
  linkLabel?: string;
};

export default function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  light = false,
  linkHref,
  linkLabel,
}: SectionHeaderProps) {
  const centered = align === "center";
  return (
    <div
      className={`flex flex-col gap-4 ${centered ? "items-center text-center" : "lg:flex-row lg:items-end lg:justify-between"}`}
    >
      <div className={centered ? "max-w-2xl" : "max-w-2xl"}>
        {eyebrow && <span className={`eyebrow ${light ? "eyebrow--light" : ""}`}>{eyebrow}</span>}
        <h2
          className={`section-title mt-4 text-3xl lg:text-[2.6rem] ${light ? "text-white" : "text-[#14100c]"}`}
        >
          {title}
        </h2>
        {description && (
          <p className={`mt-4 text-base leading-8 ${light ? "text-white/70" : "text-[var(--muted)]"}`}>
            {description}
          </p>
        )}
      </div>
      {linkHref && linkLabel && (
        <Link
          href={linkHref}
          className={`inline-flex items-center gap-2 whitespace-nowrap text-sm font-bold ${light ? "text-[#ef8e36]" : "text-[var(--primary)]"}`}
        >
          {linkLabel}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
