import { clients } from "@/data/content";

export default function ClientMarquee() {
  const row = [...clients, ...clients];
  return (
    <section className="border-y border-[var(--line)] bg-white">
      <div className="relative overflow-hidden py-10">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-[linear-gradient(90deg,#fff,transparent)]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-[linear-gradient(270deg,#fff,transparent)]" />
        <ul className="marquee-track gap-4 px-4" aria-label="주요 고객사">
          {row.map((client, index) => (
            <li
              key={`${client.name}-${index}`}
              className="flex h-20 w-52 shrink-0 items-center justify-center rounded-2xl border border-[#efe5dc] bg-white px-6 shadow-[0_8px_24px_rgba(67,48,35,0.06)]"
              title={client.name}
            >
              <div className="flex max-h-12 max-w-full flex-col items-center justify-center gap-1">
                <img
                  src={client.logo}
                  alt={`${client.name} 로고`}
                  className="max-h-11 max-w-[160px] object-contain"
                  draggable={false}
                />
                {"supportingLabel" in client && client.supportingLabel ? (
                  <span className="text-[11px] font-semibold tracking-[-0.02em] text-[#3a2e25]">
                    {client.supportingLabel}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
