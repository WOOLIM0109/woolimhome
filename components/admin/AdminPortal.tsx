"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  FileCheck2,
  Home,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Newspaper,
  Palette,
  ShieldCheck,
  Trash2,
  BookOpen,} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";

const NAV_ITEMS = [
  { href: "/admin", label: "전체 현황", icon: LayoutDashboard },
  { href: "/admin/columns", label: "홈페이지 칼럼", icon: Newspaper },
  // 세 채널이 함께 쓰는 자료실입니다. 칼럼 하위에 두면 칼럼 전용처럼 보입니다.
  { href: "/admin/knowledge", label: "노하우 자료실", icon: BookOpen },
  { href: "/admin/bot-traffic", label: "봇 트래픽", icon: Bot },
  { href: "/admin/naver-consulting", label: "컨설팅 블로그", icon: Home },
  { href: "/admin/naver-design", label: "디자인 블로그", icon: Palette },
  { href: "/admin/reviews", label: "검토 요청", icon: FileCheck2 },
  { href: "/admin/schedule", label: "발행 일정", icon: CalendarDays },
  { href: "/admin/sources", label: "주제·자료 수집", icon: Bell },
  { href: "/admin/editorial-maintenance", label: "AI 비용 보호", icon: ShieldCheck },
  { href: "/admin/retention", label: "데이터 정리", icon: Trash2 },
  { href: "/admin/openchat", label: "오픈채팅 자동배포", icon: MessageSquareText },
  { href: "/admin/program-review", label: "공고 검토", icon: FileCheck2 },
  { href: "/partner", label: "외주 포스팅 작업실", icon: BriefcaseBusiness },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname.startsWith(href);
}

export default function AdminPortal({
  children,
  title,
  description,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const access = useAccess(user?.email);
  const loading = authLoading || (Boolean(user) && access.loading);

  if (loading) {
    return (
      <section className="back-office min-h-[70vh] px-5 py-20 text-center text-[var(--muted)]">
        로그인 상태를 확인하고 있습니다.
      </section>
    );
  }

  if (!user) {
    return (
      <section className="back-office min-h-[70vh] px-5 py-20">
        <div className="mx-auto max-w-md border border-[var(--line)] bg-white p-10 text-center">
          <p className="eyebrow justify-center text-xs">Woolim Admin</p>
          <h1 className="mt-5 text-3xl font-bold">울림 콘텐츠 관리자</h1>
          <p className="prose-muted mt-4">승인된 Google 계정으로 로그인해 주세요.</p>
          <button
            onClick={() => void signInWithGoogle()}
            className="btn-gradient mt-8 inline-flex h-12 items-center justify-center px-6 font-bold text-white"
          >
            Google로 로그인
          </button>
        </div>
      </section>
    );
  }

  if (!access.admin) {
    return (
      <section className="back-office min-h-[70vh] px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-[#b91c1c]">
          {access.error ? "권한을 확인하지 못했습니다." : "접근 권한이 없습니다."}
        </h1>
        <p className="prose-muted mt-3">{access.error || `${user.email} 계정에는 관리자 권한이 없습니다.`}</p>
        <div className="mt-8 flex items-center justify-center gap-5">
          {/*
            확인 자체가 실패한 경우에는 다시 시도할 길을 줍니다. 예전에는 잠깐의
            네트워크 오류 하나로 이 화면에 굳어서, 새로고침 말고는 방법이 없었습니다.
          */}
          {access.error && (
            <button onClick={access.retry} className="btn-gradient inline-flex h-11 items-center px-5 font-bold text-white">
              다시 확인
            </button>
          )}
          <button onClick={() => void signOut()} className="underline underline-offset-4">로그아웃</button>
        </div>
      </section>
    );
  }

  return (
    <section className="back-office min-h-screen">
      <div className="mx-auto grid max-w-[1504px] gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/*
          옆 차림표는 공개 사이트의 머리글과 같은 결로 둡니다. 흰 바탕에 1px
          선, 지금 보는 곳만 주황 글씨와 왼쪽 주황 막대로 표시합니다.
        */}
        <aside className="border-b border-[var(--line)] bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 px-5 py-6">
            <Image
              src="/images/woolim-logo-cropped.png"
              alt=""
              width={80}
              height={55}
              className="h-9 w-[44px] shrink-0 object-contain"
            />
            <span className="min-w-0 leading-tight">
              <Link href="/admin" className="block truncate text-[17px] font-bold tracking-[-0.035em] text-[#161616]">
                울림 콘텐츠 관리자
              </Link>
              <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{user.email}</span>
            </span>
          </div>
          <nav className="flex gap-0 overflow-x-auto border-t border-[var(--line)] px-0 lg:block lg:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex shrink-0 items-center gap-3 border-l-[3px] px-4 py-3 text-sm font-semibold transition-colors lg:border-b lg:border-b-[#f0f0f0] ${
                    active
                      ? "border-l-[#eb6826] bg-[#fdf3ec] text-[#eb6826]"
                      : "border-l-transparent text-[#404040] hover:bg-[#fafafa] hover:text-[#eb6826]"
                  }`}
                >
                  <Icon size={17} strokeWidth={1.8} /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden px-4 pt-4 lg:block">
            <button
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 px-1 py-3 text-sm text-[var(--muted)] transition-colors hover:text-[#eb6826]"
            >
              <LogOut size={16} strokeWidth={1.8} /> 로그아웃
            </button>
          </div>
        </aside>

        <div className="min-w-0 bg-white px-5 py-9 sm:px-8 lg:px-12 lg:py-12">
          <header className="flex flex-col gap-5 border-b border-[#262626] pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-[clamp(28px,2.6vw,38px)] font-bold leading-[1.3]">{title}</h1>
              {description && <p className="prose-muted mt-3 max-w-3xl text-[17px]">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}
