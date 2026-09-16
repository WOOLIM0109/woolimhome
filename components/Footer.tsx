import Link from "next/link";
import Image from "next/image";
import { Clock, Lock, Mail, MapPin, Phone, Printer } from "lucide-react";
import { navigation, site } from "@/data/site";

export default function Footer() {
  return (
    <footer className="border-t border-[var(--line)] bg-[#111714] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 lg:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-sm bg-white">
              <Image src="/images/woolim-logo-cropped.png" alt="" width={80} height={55} className="h-9 w-12 object-contain" />
            </span>
            <div>
              <p className="font-bold">{site.name}</p>
              <p className="text-xs text-white/60">{site.englishName}</p>
            </div>
          </div>
          <p className="max-w-md text-sm leading-7 text-white/68">{site.description}</p>
        </div>

        <div>
          <p className="mb-4 text-sm font-bold">바로가기</p>
          <div className="grid grid-cols-2 gap-2 text-sm text-white/68">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-4 text-sm font-bold">문의</p>
          <ul className="space-y-3 text-sm text-white/68">
            <li className="flex gap-2">
              <Phone size={16} className="mt-0.5 shrink-0" /> {site.phone}
            </li>
            <li className="flex gap-2">
              <Printer size={16} className="mt-0.5 shrink-0" /> {site.fax}
            </li>
            <li className="flex gap-2">
              <Mail size={16} className="mt-0.5 shrink-0" /> {site.email}
            </li>
            <li className="flex gap-2">
              <MapPin size={16} className="mt-0.5 shrink-0" /> <span>{site.address}</span>
            </li>
            <li className="flex gap-2">
              <Clock size={16} className="mt-0.5 shrink-0" /> {site.businessHours} · {site.closedDays}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-5 text-xs text-white/45">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-center sm:text-left">
            대표 {site.representative} · 사업자등록번호 {site.registrationNumber} · 개인정보관리책임자 {site.representative}
          </p>
          {/*
            관리자 화면으로 바로 가는 길입니다. 주소를 외워서 치지 않아도 되게
            모든 페이지 아래에 둡니다. 손님에게는 눈에 띄지 않을 만큼만 두되,
            숨기지는 않습니다. /admin 은 로그인과 권한으로 막혀 있어서 링크가
            보이는 것만으로 열리지 않습니다.
          */}
          <Link
            href="/admin"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/45 transition hover:bg-white/10 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          >
            <Lock size={13} aria-hidden="true" />
            관리자
          </Link>
        </div>
      </div>
    </footer>
  );
}
