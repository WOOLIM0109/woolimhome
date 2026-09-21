import Link from "next/link";
import { ArrowRight } from "lucide-react";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export default function PageHero({ eyebrow, title, description, ctaHref, ctaLabel }: PageHeroProps) {
  return (
    <section className="border-b border-[#e8e8e8] bg-white">
      <div className="mx-auto max-w-[1504px] px-5 pb-16 pt-16 lg:px-12 lg:pb-24 lg:pt-28">
        <span className="inline-flex items-center gap-3 text-base font-bold tracking-[0.06em] text-[#eb6826]">
          <span className="h-1.5 w-1.5 bg-[#eb6826]" aria-hidden="true" />
          {eyebrow}
        </span>
        <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-20">
          <h1 className="max-w-3xl text-[2.3rem] leading-[1.3] font-bold tracking-[-0.03em] break-keep text-[#161616] lg:text-[3.6rem]">
            {title}
          </h1>
          <div>
            <p className="max-w-xl text-lg leading-8 break-keep text-[#686868]">{description}</p>
            {ctaHref && ctaLabel && (
              <Link
                href={ctaHref}
                className="mt-7 inline-flex h-12 items-center gap-8 border-b border-[#262626] text-sm font-bold text-[#262626] transition-colors hover:border-[#eb6826] hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
              >
                {ctaLabel}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
