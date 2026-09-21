import { Plus } from "lucide-react";
import SectionHeader from "@/components/SectionHeader";
import styles from "./PublicSections.module.css";

type Faq = {
  question: string;
  answer: string;
};

export default function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <section className={styles.faq}>
      <div className={styles.faqInner}>
        <SectionHeader eyebrow="자주 묻는 질문" title="상담 전, 이것만은 확인하세요" />
        <div className={styles.faqList}>
          {faqs.map((faq, index) => (
            <details key={faq.question} className={styles.faqItem} open={index === 0}>
              <summary className={styles.faqQuestion}>
                <span className={styles.faqNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{faq.question}</h3>
                <Plus size={20} className={styles.faqIcon} aria-hidden="true" />
              </summary>
              <p className={styles.faqAnswer}>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}