import Link from "next/link";
import { ArrowRight, MessageCircle, Phone } from "lucide-react";
import { site } from "@/data/site";

export default function ContactBand() {
  return (
    <section className="relative overflow-hidden bg-[var(--deep)] text-white">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(23,16,12,0.98),rgba(69,37,25,0.92),rgba(235,104,38,0.78))]" />
      <div className="absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-[#ef8e36]/25 blur-3xl" />
      <div className="absolute bottom-[-7rem] left-[-5rem] h-72 w-72 rounded-full bg-[#eb6826]/20 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-7 px-5 py-14 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
        <div>
          <span className="eyebrow eyebrow--light">상담 문의</span>
          <h2 className="section-title mt-4 text-3xl lg:text-4xl">
            사업의 다음 단계, 함께 그려보세요.
          </h2>
          <p className="mt-4 text-sm leading-7 text-white/70">
            계약하지 않으셔도 됩니다. 먼저 편하게 들어보시고 신중하게 결정하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/contact"
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-[var(--primary)] shadow-xl transition hover:-translate-y-0.5"
          >
            <MessageCircle size={17} />
            상담 신청하기
            <ArrowRight size={16} />
          </Link>
          <a
            href={`tel:${site.phone.replaceAll("-", "")}`}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 text-sm font-bold text-white shadow-lg backdrop-blur transition hover:-translate-y-0.5"
          >
            <Phone size={17} />
            {site.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
