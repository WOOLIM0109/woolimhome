import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./PublicSections.module.css";

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
  return (
    <div className={`${styles.sectionHeader} ${align === "center" ? styles.centered : ""} ${light ? styles.light : ""}`}>
      <div className={styles.headerCopy}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {linkHref && linkLabel ? (
        <Link href={linkHref} className={styles.sectionLink}>
          {linkLabel}
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}