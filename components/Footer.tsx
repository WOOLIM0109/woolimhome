import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Lock } from "lucide-react";
import { site } from "@/data/site";

export default function Footer() {
  return (
    <footer className="border-t border-[#e8e8e8] bg-white text-[#161616]">
      <div className="mx-auto max-w-[1504px] px-5 lg:px-12">
        <div className="grid gap-12 py-16 lg:grid-cols-[1.15fr_1fr] lg:gap-24 lg:py-24">
          <div>
            <p className="text-sm font-semibold tracking-[0.12em] text-[#858585]">WOOLIM COMPANY</p>
            <h2 className="mt-6 text-[2rem] leading-[1.45] font-bold tracking-[-0.045em] lg:text-[2.8rem]">
              함께 만드는
              <br />
              기업의 다음 성장<span className="text-[#eb6826]">.</span>
            </h2>
            <Link
              href="/contact"
              className="mt-8 inline-flex items-center gap-12 border-b border-[#262626] pb-3 text-lg font-semibold transition-colors hover:border-[#eb6826] hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
            >
              울림과 이야기 나누기
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>

          <div className="lg:justify-self-end lg:pt-2">
            <div>
              <p className="text-sm font-semibold tracking-[0.08em] text-[#858585]">울림과 이야기 나누세요</p>
              <a
                href={`tel:${site.phone.replaceAll("-", "")}`}
                className="mt-5 inline-block text-[2rem] font-semibold tracking-[-0.035em] hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826] lg:text-[2.5rem]"
              >
                {site.phone}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="mt-3 block text-lg text-[#555] hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
              >
                {site.email}
              </a>
              <p className="mt-6 text-base leading-7 text-[#777]">
                {site.businessHours}
                <br />
                {site.closedDays} 휴무
              </p>
              <p className="mt-2 text-base leading-7 text-[#777]">FAX. {site.fax}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-7 border-t border-[#e8e8e8] py-8 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-12">
          <Link href="/" className="flex w-fit items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]" aria-label="울림컴퍼니 홈">
            <Image src="/images/woolim-logo-cropped.png" alt="" width={80} height={55} className="h-9 w-11 object-contain" />
            <span className="text-base font-bold tracking-[-0.025em]">{site.name}</span>
          </Link>
          <div className="text-base leading-7 text-[#737373]">
            <p>{site.address}</p>
            <p className="flex flex-wrap gap-x-4">
              <span>대표 {site.representative}</span>
              <span>사업자등록번호 {site.registrationNumber}</span>
              <span>개인정보관리책임자 {site.representative}</span>
            </p>
            <p className="mt-1">© WOOLIM COMPANY. All rights reserved.</p>
          </div>
          <Link
            href="/admin"
            className="inline-flex w-fit shrink-0 items-center gap-1.5 py-2 text-sm text-[#737373] transition-colors hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
          >
            <Lock size={12} aria-hidden="true" />
            관리자
          </Link>
        </div>
      </div>
    </footer>
  );
}
