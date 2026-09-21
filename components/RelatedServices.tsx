import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import { services } from "@/data/content";
import styles from "./BusinessPages.module.css";

export default function RelatedServices({ currentSlug }: { currentSlug: string }) {
  const others = services.filter((s) => s.slug !== currentSlug);
  return (
    <section className={styles.related}>
      <div className={styles.relatedInner}>
        <SectionHeader eyebrow="추천" title="함께 보면 좋은 서비스" />
        <div className={styles.relatedList}>
          {others.map((item, index) => (
            <Link key={item.href} href={item.href} className={styles.relatedItem}>
              <span className={styles.relatedNumber} aria-hidden="true">0{index + 1}</span>
              <div><h3>{item.title}</h3><p>{item.summary}</p></div>
              <ArrowUpRight size={23} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
