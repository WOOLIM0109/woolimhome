"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { navigation, site } from "@/data/site";

export default function Header() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#e8e8e8] bg-white"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className="mx-auto flex h-[76px] max-w-[1504px] items-center justify-between gap-5 px-5 lg:h-[88px] lg:px-12">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex shrink-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
          aria-label="울림컴퍼니 홈"
        >
          <span className="flex h-11 w-[50px] items-center justify-center">
            <Image src="/images/woolim-logo-cropped.png" alt="" width={80} height={55} className="h-10 w-[50px] object-contain" />
          </span>
          <span className="leading-tight">
            <span className="block text-[19px] font-bold tracking-[-0.035em] text-[#161616]">{site.name}</span>
            <span className="mt-1 block text-[9px] font-semibold tracking-[0.16em] text-[#737373]">{site.englishName}</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex xl:gap-9" aria-label="주요 메뉴">
          {navigation.map((item) => (
            <div key={item.href} className="group relative flex h-[88px] items-center">
              <Link
                href={item.href}
                className="py-3 text-[17px] font-semibold text-[#262626] transition-colors hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
              >
                {item.label}
              </Link>
              {item.children.length > 0 && (
                <div className="invisible absolute left-1/2 top-full min-w-52 -translate-x-1/2 border border-[#e8e8e8] bg-white p-3 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className="block px-3 py-3 text-base text-[#555] transition-colors hover:bg-[#f7f7f7] hover:text-[#eb6826] focus-visible:bg-[#f7f7f7] focus-visible:outline-2 focus-visible:outline-[#eb6826]"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="hidden shrink-0 lg:block">
          <Link
            href="/contact"
            className="inline-flex h-12 items-center gap-6 border border-[#eb6826] bg-[#eb6826] px-5 text-lg font-bold text-white transition-colors hover:border-[#eb6826] hover:bg-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
          >
            상담 문의
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <button
          ref={menuButton}
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eb6826] lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
        >
          {open ? <X size={25} aria-hidden="true" /> : <Menu size={25} aria-hidden="true" />}
        </button>
      </div>

      <div
        id="mobile-navigation"
        hidden={!open}
        className="max-h-[calc(100dvh-76px)] overflow-y-auto border-t border-[#e8e8e8] bg-white px-5 py-5 lg:hidden"
      >
        <nav className="mx-auto grid max-w-7xl" aria-label="모바일 메뉴">
          {navigation.map((item) => (
            <div key={item.href} className="border-b border-[#ededed] py-4">
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className="block py-1 text-base font-bold text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eb6826]"
              >
                {item.label}
              </Link>
              {item.children.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => setOpen(false)}
                      className="py-2 text-base leading-6 text-[#6a6a6a] hover:text-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#eb6826]"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Link
            href="/contact"
            onClick={() => setOpen(false)}
            className="mt-6 inline-flex h-12 items-center justify-between bg-[#eb6826] px-5 text-lg font-bold text-white transition-colors hover:bg-[#eb6826] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eb6826]"
          >
            상담 문의
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
