import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { site } from "@/data/site";
import styles from "./PublicSections.module.css";

export default function ContactBand() {
  return (
    <section className={styles.contact}>
      <div className={styles.contactInner}>
        <div className={styles.contactCopy}>
          <span className={styles.eyebrow}>상담 문의</span>
          <h2 className={styles.contactTitle}>사업의 다음 단계,<br />함께 그려보세요.</h2>
          <p className={styles.contactDescription}>
            계약하지 않으셔도 됩니다. 먼저 편하게 들어보시고 신중하게 결정하세요.
          </p>
        </div>
        <div className={styles.contactActions}>
          <Link href="/contact" className={styles.contactButton}>
            상담 신청하기
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
          <a href={`tel:${site.phone.replaceAll("-", "")}`} className={styles.contactPhone}>
            <Phone size={16} aria-hidden="true" />
            {site.phone}
          </a>
        </div>
      </div>
    </section>
  );
}