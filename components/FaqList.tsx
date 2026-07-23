import SectionHeader from "@/components/SectionHeader";

type Faq = {
  question: string;
  answer: string;
};

export default function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <section className="bg-[var(--surface-strong)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
        <SectionHeader eyebrow="자주 묻는 질문" title="상담 전, 이것만은 확인하세요" />
        <div className="mt-9 grid items-stretch gap-4 lg:grid-cols-3">
          {faqs.map((faq) => (
            <article key={faq.question} className="card h-full p-6">
              <h3 className="text-lg font-bold leading-7 text-[#14100c]">{faq.question}</h3>
              <p className="prose-muted mt-3 text-sm">{faq.answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
