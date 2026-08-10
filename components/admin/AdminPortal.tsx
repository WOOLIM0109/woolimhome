"use client";

import Link from "next/link";
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
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";

const NAV_ITEMS = [
  { href: "/admin", label: "전체 현황", icon: LayoutDashboard },
  { href: "/admin/columns", label: "홈페이지 칼럼", icon: Newspaper },
  { href: "/admin/bot-traffic", label: "봇 트래픽", icon: Bot },
  { href: "/admin/naver-consulting", label: "컨설팅 블로그", icon: Home },
  { href: "/admin/naver-design", label: "디자인 블로그", icon: Palette },
  { href: "/admin/reviews", label: "검토 요청", icon: FileCheck2 },
  { href: "/admin/schedule", label: "발행 일정", icon: CalendarDays },
  { href: "/admin/sources", label: "주제·자료 수집", icon: Bell },
  { href: "/admin/editorial-maintenance", label: "AI 비용 보호", icon: ShieldCheck },
  { href: "/admin/openchat", label: "오픈채팅 자동배포", icon: MessageSquareText },
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
    return <section className="min-h-[70vh] bg-[#fffaf7] px-5 py-20 text-center">로그인 상태를 확인하고 있습니다.</section>;
  }

  if (!user) {
    return (
      <section className="min-h-[70vh] bg-[#fffaf7] px-5 py-20">
        <div className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-3xl font-bold">울림 콘텐츠 관리자</h1>
          <p className="prose-muted mt-4">승인된 Google 계정으로 로그인해 주세요.</p>
          <button onClick={() => void signInWithGoogle()} className="btn-gradient mt-8 rounded-xl px-6 py-3 font-bold text-white">
            Google로 로그인
          </button>
        </div>
      </section>
    );
  }

  if (!access.admin) {
    return (
      <section className="min-h-[70vh] bg-[#fffaf7] px-5 py-20 text-center">
        <h1 className="text-2xl font-bold text-red-700">접근 권한이 없습니다.</h1>
        <p className="mt-3">{access.error || `${user.email} 계정에는 관리자 권한이 없습니다.`}</p>
        <button onClick={() => void signOut()} className="mt-6 underline">로그아웃</button>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#fffaf7]">
      <div className="mx-auto grid max-w-[1500px] gap-0 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--line)] bg-[#241a15] text-white lg:min-h-screen lg:border-b-0 lg:border-r">
          <div className="px-5 py-6">
            <Link href="/admin" className="text-xl font-bold">울림 콘텐츠 관리자</Link>
            <p className="mt-1 text-xs text-white/60">{user.email}</p>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-3 pb-4 lg:block lg:space-y-1 lg:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition ${
                    active ? "bg-[#ef762f] text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={18} /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden px-4 pt-4 lg:block">
            <button onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm text-white/60 hover:bg-white/10 hover:text-white">
              <LogOut size={17} /> 로그아웃
            </button>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <header className="flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">{title}</h1>
              {description && <p className="prose-muted mt-2 max-w-3xl">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
          </header>
          {children}
        </main>
      </div>
    </section>
  );
}
