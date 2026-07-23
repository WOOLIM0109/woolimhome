"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Menu, MessageCircle, X } from "lucide-react";
import { navigation, site } from "@/data/site";

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-white/94 backdrop-blur">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="울림컴퍼니 홈">
          <span className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-sm bg-white">
            <Image src="/images/woolim-logo-cropped.png" alt="" width={80} height={55} className="h-9 w-12 object-contain" />
          </span>
          <span className="leading-tight">
            <span className="block text-base font-bold tracking-normal">{site.name}</span>
            <span className="block text-xs font-semibold text-[var(--muted)]">{site.englishName}</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="주요 메뉴">
          {navigation.map((item) => (
            <div key={item.href} className="group relative flex h-18 items-center">
              <Link href={item.href} className="text-sm font-semibold text-[#26302a] transition hover:text-[var(--primary)]">
                {item.label}
              </Link>
              <div className="invisible absolute left-1/2 top-full min-w-44 -translate-x-1/2 rounded-sm border border-[var(--line)] bg-white p-2 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className="block rounded-sm px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--primary)]"
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/contact"
            className="btn-gradient inline-flex h-10 items-center gap-2 rounded-sm px-4 text-sm font-bold text-white"
          >
            <MessageCircle size={17} />
            상담 문의
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-[var(--line)] lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--line)] bg-white px-5 py-4 lg:hidden">
          <nav className="mx-auto grid max-w-7xl gap-4" aria-label="모바일 메뉴">
            {navigation.map((item) => (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block py-1 text-base font-bold text-[#26302a]"
                >
                  {item.label}
                </Link>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => setOpen(false)}
                      className="rounded-sm bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--muted)]"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
