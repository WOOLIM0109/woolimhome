import { clients } from "@/data/content";

export default function ClientMarquee() {
  const row = [...clients, ...clients];
  return (
    <section className="border-y border-[var(--line)] bg-white">
      <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
        <p className="text-center text-sm font-semibold text-[var(--muted)]">
          대기업 · 공공기관과 함께한 서류 · PPT 기획/디자인
        </p>
      </div>
      <div className="relative overflow-hidden pb-10">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-[linear-gradient(90deg,#fff,transparent)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-[linear-gradient(270deg,#fff,transparent)]" />
        <ul className="marquee-track gap-3 px-3" aria-label="주요 고객사">
          {row.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className="flex h-12 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-6 text-sm font-bold text-[#3a2e25]"
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
